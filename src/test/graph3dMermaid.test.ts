import * as assert from 'assert';
import { looksLikeMermaid, mermaidTitle, parseMermaid, parseNodeRef, splitAmpersand, splitStatements } from '../graph3d/mermaid';
import type { GraphEdge, GraphNode, ParsedGraph } from '../graph3d/types';

function byId(graph: ParsedGraph): Map<string, GraphNode> {
	return new Map(graph.nodes.map(node => [node.id, node]));
}

function edgeSummary(graph: ParsedGraph): string[] {
	const nodes = byId(graph);
	return graph.edges.map((edge: GraphEdge) =>
		`${nodes.get(edge.source)?.label ?? edge.source} > ${nodes.get(edge.target)?.label ?? edge.target}${edge.label ? ` [${edge.label}]` : ''}`);
}

describe('graph3d/mermaid', () => {
	it('flowchart：节点形状、标签、边标签、方向', () => {
		const graph = parseMermaid([
			'flowchart LR',
			'A[开始] --> B{判断}',
			'B -->|是| C([处理])',
			'B -->|否| D((结束))',
			'C --> D',
		].join('\n'));
		assert.strictEqual(graph.kind, 'flowchart');
		assert.strictEqual(graph.direction, 'LR');
		assert.deepStrictEqual(graph.nodes.map(node => [node.id, node.label, node.shape]), [
			['A', '开始', 'box'],
			['B', '判断', 'diamond'],
			['C', '处理', 'stadium'],
			['D', '结束', 'circle'],
		]);
		assert.deepStrictEqual(edgeSummary(graph), [
			'开始 > 判断',
			'判断 > 处理 [是]',
			'判断 > 结束 [否]',
			'处理 > 结束',
		]);
	});

	it('flowchart：A & B --> C、链式箭头、-- 文字 --> 写法', () => {
		const graph = parseMermaid([
			'flowchart TD',
			'A & B --> C',
			'C --> D --> E',
			'F -- 真 --> G',
			'H -->|假| I',
		].join('\n'));
		assert.deepStrictEqual(edgeSummary(graph), [
			'A > C',
			'B > C',
			'C > D',
			'D > E',
			'F > G [真]',
			'H > I [假]',
		]);
	});

	it('flowchart：subgraph 归属到分组，节点只创建一次', () => {
		const graph = parseMermaid([
			'flowchart TD',
			'subgraph 模块',
			'A[一] --> B[二]',
			'end',
			'A --> C[三]',
		].join('\n'));
		assert.deepStrictEqual(graph.groups?.map(group => group.label), ['模块']);
		assert.strictEqual(byId(graph).get('A')?.group, graph.groups?.[0].id);
		assert.strictEqual(byId(graph).get('C')?.group, undefined);
		assert.strictEqual(graph.nodes.length, 3);
	});

	it('sequenceDiagram：participant 别名、消息、虚线、Note 不计入图', () => {
		const graph = parseMermaid([
			'sequenceDiagram',
			'participant A as 用户',
			'participant B as 系统',
			'A->>B: 登录',
			'B-->>A: 成功',
			'Note over A,B: 仅备注',
			'loop 重试',
			'A->>B: 再试一次',
			'end',
		].join('\n'));
		assert.strictEqual(graph.kind, 'sequence');
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['用户', '系统']);
		assert.strictEqual(graph.edges.length, 3, 'loop 内的消息仍然存在，只是不建分组');
		assert.strictEqual(graph.edges[1].dashed, true);
		assert.strictEqual(graph.edges[1].label, '成功');
		assert.strictEqual(graph.edges[2].label, '再试一次');
	});

	it('classDiagram：成员、继承方向、关联标签', () => {
		const graph = parseMermaid([
			'classDiagram',
			'class Animal {',
			'  +String name',
			'  +eat()',
			'}',
			'Animal <|-- Dog',
			'Dog --> Food : eats',
			'Owner "1" --> "*" Dog : owns',
		].join('\n'));
		assert.strictEqual(graph.kind, 'class');
		const animal = byId(graph).get('Animal');
		assert.deepStrictEqual(animal?.detail, ['+String name', '+eat()']);
		assert.deepStrictEqual(edgeSummary(graph), [
			'Dog > Animal',
			'Dog > Food [eats]',
			'Owner > Dog [owns]',
		]);
	});

	it('stateDiagram：[*] 起点 / 终点、别名、描述', () => {
		const graph = parseMermaid([
			'stateDiagram-v2',
			'state "仍然运行" as Running',
			'[*] --> Idle',
			'Idle --> Running : start',
			'Running --> [*] : done',
			'Running : 持续输出',
		].join('\n'));
		assert.strictEqual(graph.kind, 'state');
		assert.strictEqual(byId(graph).get('Running')?.label, '仍然运行');
		assert.deepStrictEqual(graph.nodes.map(node => node.shape).filter(Boolean).sort(), ['round', 'round', 'state-end', 'state-start']);
		assert.deepStrictEqual(edgeSummary(graph), ['● > Idle', 'Idle > 仍然运行 [start]', '仍然运行 > ◉ [done]']);
	});

	it('erDiagram：实体字段与关系', () => {
		const graph = parseMermaid([
			'erDiagram',
			'CUSTOMER ||--o{ ORDER : places',
			'CUSTOMER {',
			'  string name',
			'  int id PK',
			'}',
		].join('\n'));
		assert.strictEqual(graph.kind, 'er');
		assert.deepStrictEqual(byId(graph).get('CUSTOMER')?.detail, ['string name', 'int id PK']);
		assert.deepStrictEqual(edgeSummary(graph), ['CUSTOMER > ORDER [places]']);
		assert.strictEqual(graph.edges[0].arrow, 'none');
	});

	it('mindmap：按缩进建树并剥掉形状包装', () => {
		const graph = parseMermaid([
			'mindmap',
			'  root((根))',
			'    A[分支 A]',
			'      A1(叶子)',
			'    B(Branch B)',
		].join('\n'));
		assert.strictEqual(graph.kind, 'mindmap');
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['根', '分支 A', '叶子', 'Branch B']);
		assert.deepStrictEqual(edgeSummary(graph), ['根 > 分支 A', '分支 A > 叶子', '根 > Branch B']);
	});

	it('gitGraph：提交链、分支、合并', () => {
		const graph = parseMermaid([
			'gitGraph',
			'commit id: "a1"',
			'commit id: "a2"',
			'branch dev',
			'checkout dev',
			'commit id: "b1"',
			'checkout main',
			'merge dev',
		].join('\n'));
		assert.strictEqual(graph.kind, 'gitgraph');
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['a1', 'a2', 'b1', 'merge dev']);
		assert.strictEqual(graph.edges.length, 4);
		assert.strictEqual(graph.edges.some(edge => edge.dashed), true);
	});

	it('pie：标题作为中心节点，分片挂到中心', () => {
		const graph = parseMermaid([
			'pie title 宠物',
			'"Dogs" : 386',
			'"Cats" : 85',
		].join('\n'));
		assert.strictEqual(graph.kind, 'pie');
		assert.strictEqual(graph.title, '宠物');
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['宠物', 'Dogs · 386', 'Cats · 85']);
		assert.strictEqual(graph.edges.length, 2);
	});

	it('frontmatter title 与未知图种兜底', () => {
		const titled = parseMermaid(['---', 'title: 登录流程', '---', 'flowchart TD', 'A-->B'].join('\n'));
		assert.strictEqual(titled.title, '登录流程');
		assert.strictEqual(mermaidTitle(['---', 'title: 登录流程', '---', 'flowchart TD'].join('\n')), '登录流程');

		const unknown = parseMermaid('requirementDiagram\nrequirement 登录 {\n  id: 1\n}');
		assert.strictEqual(unknown.kind, 'unknown');
		assert.ok(unknown.nodes.length > 0);
		assert.ok(unknown.note?.includes('通用兜底'));
		assert.strictEqual(looksLikeMermaid('requirementDiagram'), false);
		assert.strictEqual(looksLikeMermaid('flowchart TD'), true);
	});

	it('节点引用解析器覆盖常见形状', () => {
		assert.deepStrictEqual(parseNodeRef('A[文本]'), { id: 'A', label: '文本', shape: 'box', explicitLabel: true });
		assert.strictEqual(parseNodeRef('A(((圆)))')?.shape, 'double-circle');
		assert.strictEqual(parseNodeRef('A{{六边形}}')?.shape, 'hexagon');
		assert.strictEqual(parseNodeRef('A[(数据库)]')?.shape, 'database');
		assert.strictEqual(parseNodeRef('A>旗标]')?.shape, 'asymmetric');
		assert.strictEqual(parseNodeRef('A:::hot')?.label, 'A');
		assert.strictEqual(parseNodeRef('plain')?.explicitLabel, false);
	});

	it('语句 / & 分割尊重括号与引号', () => {
		assert.deepStrictEqual(splitStatements('A[含;分号] --> B; B --> C'), ['A[含;分号] --> B', 'B --> C']);
		assert.deepStrictEqual(splitAmpersand('A & B[含&符号] & C'), ['A', 'B[含&符号]', 'C']);
	});

	it('长箭头与左向箭头都能解析，标签里的箭头不会切开节点', () => {
		const long = parseMermaid([
			'flowchart TD',
			'A ---> B',
			'B ----> C',
			'C ====> D',
			'D <---- E',
			'F["a --> b"] --> G',
			'H[--->] --> I',
		].join('\n'));
		assert.deepStrictEqual(edgeSummary(long), [
			'A > B',
			'B > C',
			'C > D',
			'E > D',
			'a --> b > G',
			'---> > I',
		]);
		assert.strictEqual(byId(long).get('D')?.label, 'D');
		assert.strictEqual(byId(long).get('F')?.label, 'a --> b');
		assert.strictEqual(long.nodes.some(node => node.label === 'b"]'), false, '引号里的箭头不能造出假节点');
	});

	it('长箭头 / 开放链接都支持文字，标签不会被当成节点', () => {
		const graph = parseMermaid([
			'flowchart TD',
			'A -- 真 ---> B',
			'C == 粗 ===> D',
			'E -. 点 .-> F',
			'G --- 开放 --- H',
			'I === 粗开放 === J',
		].join('\n'));
		assert.deepStrictEqual(edgeSummary(graph), [
			'A > B [真]',
			'C > D [粗]',
			'E > F [点]',
			'G > H [开放]',
			'I > J [粗开放]',
		]);
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
	});

	it('Mermaid 实体：#quot;、#9829;、#x2665; 与 HTML 实体都能解码', () => {
		const graph = parseMermaid([
			'flowchart TD',
			'A["double:#quot; quote"] --> B["heart:#9829;"]',
			'B --> C["hex:#x2665;"]',
			'C --> D["amp:&amp; lt:&lt;"]',
		].join('\n'));
		assert.deepStrictEqual(graph.nodes.map(node => node.label), [
			'double:" quote',
			'heart:♥',
			'hex:♥',
			'amp:& lt:<',
		]);
	});

	it('超过 MAX_NODES(600) 时截断节点并丢弃悬挂边', () => {
		const lines = ['flowchart TD'];
		for (let index = 0; index < 700; index += 1) {
			lines.push(`N${index} --> N${index + 1}`);
		}
		const graph = parseMermaid(lines.join('\n'));
		assert.strictEqual(graph.nodes.length, 600);
		assert.ok(graph.edges.length <= 600);
		assert.ok(graph.note?.includes('截断'), '截断必须留下可诊断的 note');
		const ids = new Set(graph.nodes.map(node => node.id));
		assert.ok(graph.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)), '不能留下端点不存在的边');

		const mindmapLines = ['mindmap', '  root'];
		for (let index = 0; index < 700; index += 1) {
			mindmapLines.push(`    n${index}`);
		}
		const mindmap = parseMermaid(mindmapLines.join('\n'));
		assert.strictEqual(mindmap.nodes.length, 600);
		assert.ok(mindmap.note?.includes('截断'));
	});

	it('未知图种跳过单独的花括号行，仍按行串成链', () => {
		const graph = parseMermaid('requirementDiagram\nrequirement 登录 {\n  id: 1\n}');
		assert.strictEqual(graph.kind, 'unknown');
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['requirement 登录 {', 'id: 1']);
		assert.strictEqual(graph.edges.length, 1);
	});

	it('%% 注释挂到本行新建节点：连续整行注释合并，行尾注释属于同一行', () => {
		const graph = parseMermaid([
			'flowchart TD',
			'  %% 登录流程',
			'  %% 第二行说明',
			'  A[登录] --> B[校验] %% 校验密码',
			'  B --> C[主页]',
		].join('\n'));
		const byId = new Map(graph.nodes.map(node => [node.id, node]));
		assert.strictEqual(byId.get('A')?.comment, '登录流程\n第二行说明\n校验密码');
		assert.strictEqual(byId.get('B')?.comment, '登录流程\n第二行说明\n校验密码');
		assert.strictEqual(byId.get('C')?.comment, undefined);
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['登录', '校验', '主页']);
	});

	it('注释不会产生节点，init 指令不会被当成注释', () => {
		const graph = parseMermaid([
			'%%{init: {"theme": "dark"}}%%',
			'flowchart TD',
			'  %% 只在注释里出现的文字',
			'  A --> B',
		].join('\n'));
		assert.deepStrictEqual(graph.nodes.map(node => node.label), ['A', 'B']);
		assert.ok(graph.nodes.every(node => !node.comment?.includes('init')));
	});
});
