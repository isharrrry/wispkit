import type { LnkDetails } from '../shellLink/lnk';
import type { PeDetails } from '../executable/pe';
import type { BinaryEditForm, BinarySection } from './page';

/**
 * 把解析结果翻译成属性页。纯函数：磁盘探测（目标是否存在）由调用方做完再传进来，
 * 这样这些文案与分组可以在没有 VS Code 的环境里单测。
 */

export interface PathProbe {
	readonly exists: boolean;
	readonly isDirectory: boolean;
}

export interface ShellLinkDescription {
	readonly subtitle: string;
	readonly sections: readonly BinarySection[];
	readonly notices: readonly string[];
	readonly form?: BinaryEditForm;
}

export interface ExecutableDescription {
	readonly subtitle: string;
	readonly sections: readonly BinarySection[];
	readonly notices: readonly string[];
}

const SHOW_COMMAND_NAMES: Record<number, string> = {
	1: '普通窗口',
	3: '最大化',
	7: '最小化',
};

function text(value: string | undefined): string {
	return value && value.trim() ? value : '—';
}

function yesNo(value: boolean): string {
	return value ? '是' : '否';
}

function fileTime(value: string | undefined): string {
	return value ? value.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC') : '—';
}

/** LinkFlags 里为真的位，翻成人话，便于一眼看出这个 lnk 存了什么。 */
function flagLabels(details: LnkDetails): string[] {
	const flags = details.header.flags;
	const labels: string[] = [];
	if (flags.hasLinkTargetIDList) {
		labels.push('含目标 IDList');
	}
	if (flags.hasLinkInfo) {
		labels.push('含 LinkInfo');
	}
	if (flags.hasName) {
		labels.push('含名称');
	}
	if (flags.hasRelativePath) {
		labels.push('含相对路径');
	}
	if (flags.hasWorkingDir) {
		labels.push('含工作目录');
	}
	if (flags.hasArguments) {
		labels.push('含启动参数');
	}
	if (flags.hasIconLocation) {
		labels.push('含图标位置');
	}
	if (flags.isUnicode) {
		labels.push('Unicode 字符串');
	}
	if (flags.runAsUser) {
		labels.push('以管理员身份运行');
	}
	return labels;
}

export function describeShellLink(
	details: LnkDetails,
	probe: PathProbe | undefined,
	options: { readonly allowEdit: boolean; readonly platform: NodeJS.Platform },
): ShellLinkDescription {
	const targetPath = details.targetPath ?? details.environmentTarget;
	const targetState = !probe
		? '未探测'
		: probe.exists
			? (probe.isDirectory ? '存在（文件夹）' : '存在（文件）')
			: '不存在';

	const targetRows = [
		{ label: '目标', value: text(details.targetPath) },
		{ label: '目标类别', value: details.targetLooksLikeFolder ? '文件夹' : '文件' },
		{ label: '目标状态', value: targetState },
	];
	if (details.environmentTarget && details.environmentTarget !== details.targetPath) {
		targetRows.push({ label: '环境变量目标', value: details.environmentTarget });
	}
	if (details.networkPath) {
		targetRows.push({ label: '网络路径', value: details.networkPath });
	}
	targetRows.push(
		{ label: '工作目录', value: text(details.workingDirectory) },
		{ label: '启动参数', value: text(details.arguments) },
		{ label: '图标位置', value: text(details.iconLocation) },
		{ label: '备注名称', value: text(details.name) },
	);

	const headerRows = [
		{ label: '头大小', value: `${details.header.headerSize} 字节` },
		{ label: '标志位', value: flagLabels(details).join('、') || '—' },
		{ label: '文件属性', value: `0x${details.header.fileAttributes.toString(16).toUpperCase()}` },
		{ label: '显示方式', value: `${SHOW_COMMAND_NAMES[details.header.showCommand] ?? '未知'}（${details.header.showCommand}）` },
		{ label: '文件大小', value: `${details.header.fileSize} 字节` },
		{ label: '图标索引', value: String(details.header.iconIndex) },
		{ label: '创建时间', value: fileTime(details.header.creationTime) },
		{ label: '访问时间', value: fileTime(details.header.accessTime) },
		{ label: '修改时间', value: fileTime(details.header.writeTime) },
	];
	if (details.volumeLabel) {
		headerRows.push({ label: '卷标', value: details.volumeLabel });
	}
	if (details.volumeSerialNumber) {
		headerRows.push({ label: '卷序列号', value: details.volumeSerialNumber });
	}
	if (details.machineId) {
		headerRows.push({ label: '创建机器', value: details.machineId });
	}

	const sections: BinarySection[] = [
		{ title: '快捷方式', rows: targetRows },
		{ title: '头部字段', rows: headerRows },
	];

	const notices: string[] = [];
	if (details.ignoredBlocks.length > 0) {
		notices.push(`有 ${details.ignoredBlocks.length} 个未使用的数据块被跳过：${details.ignoredBlocks.join('、')}`);
	}
	if (!details.targetPath && details.environmentTarget) {
		notices.push('没有绝对目标路径，只有带环境变量的目标；内部打开会失败，只能交给系统解析。');
	}
	if (!details.targetPath && !details.environmentTarget) {
		notices.push('这个快捷方式里没有可读的目标路径（可能只存了目标 IDList）。');
	}

	const form = options.allowEdit && options.platform === 'win32'
		? {
			note: '保存会用 Windows 自己的 CreateShortcut 接口写回，快捷方式的图标、热键等其它内容保持原样。只改你动过的字段。',
			fields: [
				{
					key: 'targetPath' as const,
					label: '目标路径',
					value: targetPath ?? '',
					placeholder: 'C:\\Windows\\System32\\notepad.exe',
					multiline: false,
				},
				{
					key: 'workingDirectory' as const,
					label: '工作目录',
					value: details.workingDirectory ?? '',
					placeholder: '留空表示由目标自己决定',
					multiline: false,
				},
				{
					key: 'arguments' as const,
					label: '启动参数',
					value: details.arguments ?? '',
					placeholder: '可以包含空格',
					multiline: true,
				},
				{
					key: 'description' as const,
					label: '备注',
					value: details.name ?? '',
					placeholder: '显示在资源管理器的描述列',
					multiline: false,
				},
			],
		}
		: undefined;

	return {
		subtitle: `Windows 快捷方式 · ${targetPath ?? '目标未知'}`,
		sections,
		notices,
		form,
	};
}

export function describeExecutable(details: PeDetails): ExecutableDescription {
	const sections: BinarySection[] = [
		{
			title: '基本信息',
			rows: [
				{ label: '格式', value: details.format },
				{ label: '架构', value: `${details.machine}（0x${details.machineRaw.toString(16).toUpperCase()}）` },
				{ label: '子系统', value: `${details.subsystem}（${details.subsystemRaw}）` },
				{ label: '类型', value: details.isDll ? 'DLL' : '可执行程序' },
				{ label: '.NET 程序集', value: yesNo(details.isManaged) },
				{ label: '编译时间', value: `${new Date(details.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}` },
				{ label: '文件大小', value: `${details.size} 字节` },
			],
		},
		{
			title: '头字段',
			rows: [
				{ label: '映像基址', value: details.imageBase },
				{ label: '入口点 RVA', value: `0x${details.entryPointRva.toString(16).toUpperCase()}` },
				{ label: '映像大小', value: `${details.sizeOfImage} 字节` },
				{ label: '校验和', value: `0x${details.checksum.toString(16).toUpperCase()}` },
				{ label: '特性', value: details.characteristics.join('、') || '—' },
				{ label: 'DLL 特性', value: details.dllCharacteristics.join('、') || '—' },
			],
		},
		{
			title: '节表',
			rows: details.sections.length > 0
				? details.sections.map(section => ({
					label: section.name || '(无名)',
					value: `RVA 0x${section.virtualAddress.toString(16).toUpperCase()} · 虚拟 ${section.virtualSize} · 原始 ${section.rawSize} · 偏移 0x${section.rawPointer.toString(16).toUpperCase()}`,
					hint: section.characteristics.join('、'),
				}))
				: [{ label: '（无）', value: '节表为空' }],
		},
	];

	const version = details.version;
	if (version) {
		const rows = [
			{ label: '文件版本', value: text(version.fileVersion) },
			{ label: '产品版本', value: text(version.productVersion) },
			{ label: '公司', value: text(version.companyName) },
			{ label: '描述', value: text(version.fileDescription) },
			{ label: '产品名', value: text(version.productName) },
			{ label: '原始文件名', value: text(version.originalFilename) },
			{ label: '版权', value: text(version.legalCopyright) },
		];
		sections.push({ title: '版本资源', rows });
	}

	return {
		subtitle: `${details.format} · ${details.machine} · ${details.subsystem}`,
		sections,
		notices: [...details.notes],
	};
}
