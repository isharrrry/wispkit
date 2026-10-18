import * as assert from 'assert';
import { highlightToHtml, tokenize, tokenizeCSharp, tokenizeXaml, type HighlightToken } from '../xaml/highlight';

const joined = (tokens: readonly HighlightToken[]): string => tokens.map(token => token.text).join('');

const kindsOf = (tokens: readonly HighlightToken[], text: string): string[] => tokens
	.filter(token => token.text === text)
	.map(token => token.kind);

describe('xaml/highlight', () => {
	describe('tokenizeXaml', () => {
		it('逐字还原源码（少一个字符光标就会与显示错位）', () => {
			const samples = [
				'<Window x:Class="A.B">\n  <Grid />\n</Window>',
				'<?xml version="1.0"?>\n<!-- 注释 -->\n<Grid><!-- 内部 --></Grid>',
				'<TextBlock Text="a &amp; b &lt; c" />',
				'<![CDATA[ <raw> & stuff ]]>',
				'<!DOCTYPE x>\n<A/>',
				'a < b 这种不是标签的尖括号',
				'',
			];
			for (const sample of samples) {
				assert.strictEqual(joined(tokenizeXaml(sample)), sample, `往返失败：${sample}`);
			}
		});

		it('标签名与闭合尖括号算 tag', () => {
			const tokens = tokenizeXaml('<Grid>');
			assert.deepStrictEqual(kindsOf(tokens, '<Grid'), ['tag']);
			assert.deepStrictEqual(kindsOf(tokens, '>'), ['tag']);
		});

		it('属性名（含命名空间前缀）算 attr，值算 string', () => {
			const source = '<Window x:Class="NewsBoard.MainWindow" Width="800">';
			const tokens = tokenizeXaml(source);
			assert.deepStrictEqual(kindsOf(tokens, 'x:Class'), ['attr']);
			assert.deepStrictEqual(kindsOf(tokens, '"NewsBoard.MainWindow"'), ['string']);
			assert.deepStrictEqual(kindsOf(tokens, 'Width'), ['attr']);
		});

		it('自闭合标签后的文本不再被当成属性', () => {
			const tokens = tokenizeXaml('<Grid />\nWidth = 1');
			assert.ok(!tokens.some(token => token.kind === 'attr' && token.text === 'Width'), '标签外不该出现属性高亮');
		});

		it('注释、CDATA、XML 声明、DOCTYPE 各自成类', () => {
			assert.deepStrictEqual(kindsOf(tokenizeXaml('<!-- c -->'), '<!-- c -->'), ['comment']);
			assert.deepStrictEqual(kindsOf(tokenizeXaml('<![CDATA[x]]>'), '<![CDATA[x]]>'), ['cdata']);
			assert.deepStrictEqual(kindsOf(tokenizeXaml('<?xml version="1.0"?>'), '<?xml version="1.0"?>'), ['preproc']);
			assert.deepStrictEqual(kindsOf(tokenizeXaml('<!DOCTYPE x>'), '<!DOCTYPE x>'), ['doctype']);
		});

		it('未闭合的注释不会吃掉后面所有内容之外的东西（照样往返）', () => {
			const source = '<Grid>\n<!-- 没关掉\n<TextBlock />';
			assert.strictEqual(joined(tokenizeXaml(source)), source);
			assert.deepStrictEqual(kindsOf(tokenizeXaml(source), '<!-- 没关掉\n<TextBlock />'), ['comment']);
		});
	});

	describe('tokenizeCSharp', () => {
		it('逐字还原源码', () => {
			const samples = [
				'public partial class MainWindow : Window\n{\n    public MainWindow() { }\n}',
				'// 注释\nvar s = "a \\" b";',
				'/* 块注释\n跨行 */\nint n = 0x1F;',
				'[STAThread]\n[Obsolete("x")]\nstatic void Main() { }',
				'var items = new List<int>(); items[0] = 1;',
				'var verbatim = @"C:\\path\\to";\nvar ch = \'x\';',
				'',
			];
			for (const sample of samples) {
				assert.strictEqual(joined(tokenizeCSharp(sample)), sample, `往返失败：${sample}`);
			}
		});

		it('关键字、类型、数字、字符串各归其类', () => {
			const tokens = tokenizeCSharp('public class MainWindow { int n = 42; string s = "hi"; }');
			assert.deepStrictEqual(kindsOf(tokens, 'public'), ['keyword']);
			assert.deepStrictEqual(kindsOf(tokens, 'class'), ['keyword']);
			assert.deepStrictEqual(kindsOf(tokens, 'MainWindow'), ['type']);
			assert.deepStrictEqual(kindsOf(tokens, 'int'), ['keyword']);
			assert.deepStrictEqual(kindsOf(tokens, '42'), ['number']);
			assert.deepStrictEqual(kindsOf(tokens, '"hi"'), ['string']);
		});

		it('行注释与块注释', () => {
			assert.deepStrictEqual(kindsOf(tokenizeCSharp('// hi'), '// hi'), ['comment']);
			assert.deepStrictEqual(kindsOf(tokenizeCSharp('/* hi */'), '/* hi */'), ['comment']);
		});

		it('字符串里的 // 不算注释', () => {
			const tokens = tokenizeCSharp('var url = "http://a/b";');
			assert.deepStrictEqual(kindsOf(tokens, '"http://a/b"'), ['string']);
			assert.ok(!tokens.some(token => token.kind === 'comment'), '字符串里的 // 不该被当成注释');
		});

		it('转义引号不会提前结束字符串', () => {
			const tokens = tokenizeCSharp('var s = "a \\" // b";');
			assert.deepStrictEqual(kindsOf(tokens, '"a \\" // b"'), ['string']);
		});

		it('逐字字符串里的双写引号', () => {
			const source = 'var s = @"a ""b"" c";';
			assert.deepStrictEqual(kindsOf(tokenizeCSharp(source), '@"a ""b"" c"'), ['string']);
			assert.strictEqual(joined(tokenizeCSharp(source)), source);
		});

		it('行首方括号是特性，数组索引不是', () => {
			assert.deepStrictEqual(kindsOf(tokenizeCSharp('[STAThread]'), '[STAThread]'), ['attribute']);
			assert.deepStrictEqual(kindsOf(tokenizeCSharp('    [Obsolete("x")]'), '[Obsolete("x")]'), ['attribute']);

			const index = tokenizeCSharp('var v = items[Index];');
			assert.ok(!index.some(token => token.kind === 'attribute'), '行内数组索引不该被当成特性');
		});

		it('#region 之类算预处理指令', () => {
			assert.deepStrictEqual(kindsOf(tokenizeCSharp('#region A'), '#region A'), ['preproc']);
		});
	});

	describe('highlightToHtml', () => {
		it('无论什么输入都不产生可执行的 HTML（转义安全）', () => {
			const hostile = '<script>alert(1)</script> & <img src=x onerror=alert(2)>';
			for (const language of ['xaml', 'csharp'] as const) {
				const html = highlightToHtml(hostile, language);
				assert.ok(!html.includes('<script'), `${language}: 不能出现 <script`);
				assert.ok(!html.includes('<img'), `${language}: 不能出现 <img`);
				assert.ok(!/<\/?[a-z]/i.test(html.replace(/<\/?span[^>]*>/g, '')), `${language}: 除 span 外不该有别的标签`);
			}
		});

		it('XAML 源码里的尖括号全部被转义', () => {
			assert.strictEqual(highlightToHtml('<Grid/>', 'xaml'), '<span class="wispkit-hl-tag">&lt;Grid</span><span class="wispkit-hl-tag">/&gt;</span>');
		});

		it('属性值里的 & 被转义', () => {
			assert.ok(highlightToHtml('<T Text="a & b" />', 'xaml').includes('&amp;'));
		});

		it('C# 的注释与关键字带上对应 class', () => {
			const html = highlightToHtml('// hi', 'csharp');
			assert.ok(html.includes('class="wispkit-hl-comment"'));
			assert.ok(highlightToHtml('public void M() { }', 'csharp').includes('class="wispkit-hl-keyword"'));
		});

		it('纯文本不加多余 span', () => {
			assert.strictEqual(highlightToHtml('plain text', 'csharp'), 'plain text');
		});

		it('超长源码退化成纯文本，仍然转义', () => {
			const huge = `<A>${'x'.repeat(130000)}`;
			const html = highlightToHtml(huge, 'xaml');
			assert.strictEqual(html, `&lt;A&gt;${'x'.repeat(130000)}`);
			assert.ok(!html.includes('<span'), '超长时不应生成高亮 span');
		});

		it('语言参数决定用哪套规则', () => {
			assert.ok(highlightToHtml('class', 'csharp').includes('wispkit-hl-keyword'));
			assert.ok(!highlightToHtml('class', 'xaml').includes('wispkit-hl-keyword'));
		});

		it('tokenize 按语言分派', () => {
			assert.deepStrictEqual(tokenize('class', 'csharp'), tokenizeCSharp('class'));
			assert.deepStrictEqual(tokenize('<A/>', 'xaml'), tokenizeXaml('<A/>'));
		});
	});
});
