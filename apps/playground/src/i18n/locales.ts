export type Locale = 'zh-CN' | 'en-US'

export type MessageKey =
  | 'appTitle'
  | 'langLabel'
  | 'ready'
  | 'toolSelect'
  | 'toolPan'
  | 'toolLine'
  | 'toolRect'
  | 'toolEllipse'
  | 'toolCircle'
  | 'toolPolyline'
  | 'toolPen'
  | 'toolBrush'
  | 'toolText'
  | 'toolImage'
  | 'tipSelect'
  | 'tipPan'
  | 'tipLine'
  | 'tipRect'
  | 'tipEllipse'
  | 'tipCircle'
  | 'tipPolyline'
  | 'tipPen'
  | 'tipBrush'
  | 'tipText'
  | 'tipImage'
  | 'fit'
  | 'process'
  | 'undo'
  | 'redo'
  | 'unit'
  | 'grid'
  | 'rulers'
  | 'workArea'
  | 'workAreaUnbounded'
  | 'workAreaPage'
  | 'workAreaSize'
  | 'group'
  | 'ungroup'
  | 'hitMode'
  | 'hitModeBounds'
  | 'hitModeGeometry'
  | 'alignSnap'
  | 'angleSnap'
  | 'tipGroup'
  | 'tipUngroup'
  | 'runBench'
  | 'benchIdle'
  | 'benchRunning'
  | 'benchDone'
  | 'genLines'
  | 'genSquares'
  | 'metricsBackend'
  | 'metricsUnit'
  | 'metricsFrame'
  | 'metricsVisible'
  | 'metricsDraws'
  | 'metricsUpload'
  | 'metricsTool'
  | 'metricsZoom'
  | 'newDoc'
  | 'fileMenu'
  | 'newProject'
  | 'importFile'
  | 'tipImportFile'
  | 'importSvg'
  | 'importDxf'
  | 'importImage'
  | 'imageUrl'
  | 'exportSvg'
  | 'exportJson'
  | 'sideSlotHint'
  | 'offset'
  | 'offsetDirection'
  | 'offsetExternal'
  | 'offsetInner'
  | 'offsetCorner'
  | 'offsetDistance'
  | 'offsetOuterOnly'
  | 'offsetPrecision'
  | 'cancel'
  | 'confirm'
  | 'offsetNeedSelection'
  | 'boolean'
  | 'booleanUnion'
  | 'booleanSubtract'
  | 'booleanIntersect'
  | 'booleanExclude'
  | 'booleanNeedSelection'
  | 'tipBooleanSubtract'
  | 'curveText'
  | 'curveTextEnable'
  | 'curveTextHint'
  | 'settings'
  | 'settingsDocument'
  | 'settingsGuides'
  | 'settingsLanguage'
  | 'settingsImport'
  | 'settingsImportHint'
  | 'appMenu'
  | 'imageDpi'
  | 'svgDpi'
  | 'settingsDpiReset'
  | 'layers'
  | 'layersHint'
  | 'layer'
  | 'layerAdd'
  | 'layerDelete'
  | 'layerColor'
  | 'layerVisible'
  | 'layerActive'
  | 'layerMoveSelection'
  | 'layerReorder'
  | 'layerDropHint'
  | 'layerGcode'
  | 'layerGcodeEmpty'
  | 'layerGcodeHint'
  | 'engraveMode'
  | 'engraveLine'
  | 'engraveFill'
  | 'lineSpacing'
  | 'fillStyle'
  | 'fillBidirectional'
  | 'fillCrossHatch'
  | 'fillShapesIndividually'
  | 'fillOffset'
  | 'machineParams'
  | 'laserPower'
  | 'feedSpeed'
  | 'passes'
  | 'devMenu'
  | 'devBack'
  | 'devHint'
  | 'devWarn'
  | 'confirmNew'
  | 'importing'
  | 'importFailed'
  | 'exported'
  | 'promptImageUrl'
  | 'stroke'
  | 'fill'
  | 'fontSize'
  | 'arcText'
  | 'arcRadius'
  | 'arcStart'
  | 'arcSweep'
  | 'arcBaseline'
  | 'arcOuter'
  | 'arcInner'
  | 'noSelection'
  | 'inspector'
  | 'inspectorEmpty'
  | 'selected'
  | 'style'
  | 'text'
  | 'content'
  | 'image'
  | 'size'
  | 'transform'
  | 'boundsHint'
  | 'effects'
  | 'effectsDisabled'
  | 'effectsHint'
  | 'addFilter'
  | 'resetFilters'
  | 'noFilters'
  | 'customWgsl'
  | 'validateWgsl'
  | 'addCustomFilter'
  | 'compileIdle'
  | 'compileOk'
  | 'cat.Editing'
  | 'cat.Guides'
  | 'cat.Camera'
  | 'cat.Groups'
  | 'cat.SVG'
  | 'cat.DXF'
  | 'cat.Text'
  | 'cat.Geometry'
  | 'cat.Performance'
  | 'ex.basic.title'
  | 'ex.basic.desc'
  | 'ex.guides.title'
  | 'ex.guides.desc'
  | 'ex.camera.title'
  | 'ex.camera.desc'
  | 'ex.groups.title'
  | 'ex.groups.desc'
  | 'ex.svg.title'
  | 'ex.svg.desc'
  | 'ex.dxf.title'
  | 'ex.dxf.desc'
  | 'ex.text.title'
  | 'ex.text.desc'
  | 'ex.large-coords.title'
  | 'ex.large-coords.desc'
  | 'ex.million-lines.title'
  | 'ex.million-lines.desc'
  | 'ex.million-squares.title'
  | 'ex.million-squares.desc'
  | 'ex.benchmark.title'
  | 'ex.benchmark.desc'
  | 'spike.title'
  | 'spike.generated'
  | 'spike.webgpu'
  | 'spike.available'
  | 'spike.unavailable'
  | 'spike.targets'
  | 'spike.results'
  | 'spike.note'
  | 'spike.col.case'
  | 'spike.col.backend'
  | 'spike.col.entities'
  | 'spike.col.build'
  | 'spike.col.p95'
  | 'spike.col.fpsAvg'
  | 'spike.col.fpsMin'
  | 'spike.col.cpu'
  | 'spike.col.heapUsed'
  | 'spike.col.heapTotal'
  | 'spike.col.draws'
  | 'spike.col.upload'
  | 'spike.col.notes'

const zh: Record<MessageKey, string> = {
  appTitle: 'CADKit 编辑器',
  langLabel: '语言',
  ready: '就绪',
  toolSelect: '选择',
  toolPan: '平移',
  toolLine: '直线',
  toolRect: '矩形',
  toolEllipse: '椭圆',
  toolCircle: '圆',
  toolPolyline: '多段线',
  toolPen: '钢笔',
  toolBrush: '画笔',
  toolText: '文本',
  toolImage: '图片',
  tipSelect: '快捷键 V · 点选/框选，拖拽缩放旋转；空格可临时平移',
  tipPan: '快捷键 H · 拖拽平移画布，松手带惯性；中键也可平移',
  tipLine: '快捷键 L · 两点绘制直线',
  tipRect: '快捷键 R · 拖拽绘制矩形',
  tipEllipse: '快捷键 O · 拖拽绘制椭圆',
  tipCircle: '快捷键 C · 点击圆心再定半径',
  tipPolyline: '快捷键 P · 多点折线，Enter 完成',
  tipPen: '快捷键 B · 单击锚点，拖拽出贝塞尔手柄；Enter 完成，点起点闭合',
  tipBrush: '快捷键 W · 按住拖拽自由绘制',
  tipText: '快捷键 T · 点击画布输入文字',
  tipImage: '快捷键 I · 选工具后选文件，再点击画布放置；也支持拖放',
  fit: '适应视图',
  process: '处理',
  undo: '撤销',
  redo: '重做',
  unit: '单位',
  grid: '网格',
  rulers: '尺子',
  workArea: '工作区',
  workAreaUnbounded: '无界',
  workAreaPage: '页',
  workAreaSize: '尺寸',
  group: '打组',
  ungroup: '解组',
  hitMode: '选区命中',
  hitModeBounds: 'AABB框内',
  hitModeGeometry: '仅几何',
  alignSnap: '对齐吸附',
  angleSnap: '角度吸附',
  tipGroup: '将当前多选对象打成一组',
  tipUngroup: '解除选中组的编组',
  runBench: '运行尖峰基准',
  benchIdle: '基准空闲',
  benchRunning: '正在运行尖峰基准…',
  benchDone: '尖峰完成',
  genLines: '正在生成 1,000,000 条线段…',
  genSquares: '正在生成 1,000,000 个正方形…',
  metricsBackend: '后端',
  metricsUnit: '单位',
  metricsFrame: '帧耗时',
  metricsVisible: '可见',
  metricsDraws: '绘制',
  metricsUpload: '上传',
  metricsTool: '工具',
  metricsZoom: '缩放',
  newDoc: '新建',
  fileMenu: '文件',
  newProject: '新建项目',
  importFile: '导入文件',
  tipImportFile: '导入 SVG / DXF / 图片到当前文档',
  importSvg: '导入 SVG',
  importDxf: '导入 DXF',
  importImage: '导入图片',
  imageUrl: '图片 URL',
  exportSvg: '导出 SVG',
  exportJson: '导出 JSON',
  sideSlotHint: '侧栏预留区域',
  offset: '偏移',
  offsetDirection: '方向',
  offsetExternal: '向外',
  offsetInner: '向内',
  offsetCorner: '拐角',
  offsetDistance: '偏移距离',
  offsetOuterOnly: '仅外轮廓',
  offsetPrecision: '精度',
  cancel: '取消',
  confirm: '确认',
  offsetNeedSelection: '请先选择要偏移的对象',
  boolean: '布尔',
  booleanUnion: '并集',
  booleanSubtract: '差集',
  booleanIntersect: '交集',
  booleanExclude: '异或',
  booleanNeedSelection: '请先多选至少两个封闭图形',
  tipBooleanSubtract: '差集：第一个选中对象减去其余对象',
  curveText: '曲线文本',
  curveTextEnable: '沿圆弧排布',
  curveTextHint: '开启后以文字中心为基准生成默认半径圆弧，字串中点落在弧顶；半径、起止角可调。',
  settings: '设置',
  settingsDocument: '文档',
  settingsGuides: '辅助显示',
  settingsLanguage: '语言',
  settingsImport: '导入分辨率',
  settingsImportHint: '影响之后导入的文件尺寸；不会改写已有对象。',
  appMenu: '软件菜单',
  imageDpi: '图片 DPI',
  svgDpi: 'SVG DPI',
  settingsDpiReset: '恢复默认 (96 / 72)',
  layers: '图层',
  layersHint: '拖拽 ⋮⋮ 调整图层顺序；拖拽元素到其他图层可换层。',
  layer: '图层',
  layerAdd: '新建图层',
  layerDelete: '删除图层',
  layerColor: '图层颜色',
  layerVisible: '可见',
  layerActive: '当前',
  layerMoveSelection: '将选中移到当前图层',
  layerReorder: '拖拽调整图层顺序',
  layerDropHint: '拖到其他图层可换层',
  layerGcode: '雕刻参数',
  layerGcodeEmpty: '在左侧图层面板中选择一个图层，以编辑 GRBL / G-code 参数。',
  layerGcodeHint: '参数仅作用于图层，用于后续 G-code 导出；不影响画布渲染。',
  engraveMode: '雕刻方式',
  engraveLine: '线雕刻',
  engraveFill: '填充雕刻',
  lineSpacing: '线间距',
  fillStyle: '填充路径样式',
  fillBidirectional: 'Bi-directional Fill（双向填充）',
  fillCrossHatch: 'Cross-Hatch（交叉/网格填充）',
  fillShapesIndividually: 'Fill Shapes Individually（单独填充图形）',
  fillOffset: 'Offset Fill（偏移填充）',
  machineParams: '机床参数',
  laserPower: '功率',
  feedSpeed: '速度',
  passes: '次数',
  devMenu: 'Dev',
  devBack: '返回',
  devHint: '开发工具：性能压测与示例种子数据。不会切换路由或销毁编辑器。',
  devWarn: '百万实体生成可能占用大量内存，请谨慎使用。',
  confirmNew: '清空当前文档并新建？',
  importing: '正在导入…',
  importFailed: '导入失败',
  exported: '已导出',
  promptImageUrl: '输入图片 URL',
  stroke: '描边',
  fill: '填充',
  fontSize: '字号',
  arcText: '圆弧文字',
  arcRadius: '半径',
  arcStart: '起始角°',
  arcSweep: '扫角°',
  arcBaseline: '基线',
  arcOuter: '外侧',
  arcInner: '内侧',
  noSelection: '未选择',
  inspector: '检查器',
  inspectorEmpty: '选择一个对象以编辑属性',
  selected: '已选',
  style: '样式',
  text: '文本',
  content: '内容',
  image: '图片',
  size: '尺寸',
  transform: '变换',
  boundsHint: '位置/尺寸为包围盒参考（部分类型只读展示）',
  effects: '效果',
  effectsDisabled: '请单选一张图片以编辑滤镜栈',
  effectsHint: '内置滤镜与自定义 WGSL 按顺序应用',
  addFilter: '添加',
  resetFilters: '重置',
  noFilters: '无滤镜',
  customWgsl: '自定义 WGSL',
  validateWgsl: '校验',
  addCustomFilter: '添加自定义',
  compileIdle: '尚未校验',
  compileOk: '校验通过',
  'cat.Editing': '编辑',
  'cat.Guides': '辅助',
  'cat.Camera': '相机',
  'cat.Groups': '分组',
  'cat.SVG': 'SVG',
  'cat.DXF': 'DXF',
  'cat.Text': '文本',
  'cat.Geometry': '几何',
  'cat.Performance': '性能',
  'ex.basic.title': '基础画线',
  'ex.basic.desc': '尺子 + 网格 + 可交互线段',
  'ex.guides.title': '尺子与网格',
  'ex.guides.desc': 'Figma 风格标尺、单位切换、网格',
  'ex.camera.title': '缩放与平移',
  'ex.camera.desc': 'zoomAt / pan / fitView 演示',
  'ex.groups.title': 'Group 分组',
  'ex.groups.desc': '组矩阵旋转/缩放；子几何保持局部坐标',
  'ex.svg.title': 'SVG 导入',
  'ex.svg.desc': 'svg-pathdata 路径展开',
  'ex.dxf.title': 'DXF 导入',
  'ex.dxf.desc': 'dxf-render 解析 + 单位换算',
  'ex.text.title': '矢量文本',
  'ex.text.desc': '文本 shaping 与 LOD',
  'ex.large-coords.title': '超大坐标',
  'ex.large-coords.desc': 'Float64 世界坐标',
  'ex.million-lines.title': '百万线段',
  'ex.million-lines.desc': '生成 1e6 线段并测量帧耗时',
  'ex.million-squares.title': '百万正方形',
  'ex.million-squares.desc': '生成 1e6 闭合正方形并观察 FPS',
  'ex.benchmark.title': '技术尖峰基准',
  'ex.benchmark.desc': '100万正方形 WebGPU FPS/CPU/内存报告',
  'spike.title': '技术尖峰基准报告（WebGPU · 100万正方形）',
  'spike.generated': '生成时间',
  'spike.webgpu': 'WebGPU',
  'spike.available': '可用',
  'spike.unavailable': '不可用',
  'spike.targets': '冻结目标',
  'spike.results': '测量结果',
  'spike.note':
    '说明：FPS 由帧耗时换算；CPU Busy = 构建+渲染占用墙钟时间比例；Heap 来自 performance.memory（Chromium）。',
  'spike.col.case': '用例',
  'spike.col.backend': '后端',
  'spike.col.entities': '实体数',
  'spike.col.build': '构建 ms',
  'spike.col.p95': '帧 p95',
  'spike.col.fpsAvg': 'FPS 均',
  'spike.col.fpsMin': 'FPS 最低',
  'spike.col.cpu': 'CPU 忙碌',
  'spike.col.heapUsed': 'Heap 占用 MB',
  'spike.col.heapTotal': 'Heap 总量 MB',
  'spike.col.draws': '绘制次数',
  'spike.col.upload': '上传 MB',
  'spike.col.notes': '备注',
}

const en: Record<MessageKey, string> = {
  appTitle: 'CADKit Editor',
  langLabel: 'Language',
  ready: 'Ready',
  toolSelect: 'Select',
  toolPan: 'Pan',
  toolLine: 'Line',
  toolRect: 'Rectangle',
  toolEllipse: 'Ellipse',
  toolCircle: 'Circle',
  toolPolyline: 'Polyline',
  toolPen: 'Pen',
  toolBrush: 'Brush',
  toolText: 'Text',
  toolImage: 'Image',
  tipSelect: 'Shortcut V · click/box select, scale & rotate; Space for temporary pan',
  tipPan: 'Shortcut H · drag to pan the canvas (inertia); middle mouse also pans',
  tipLine: 'Shortcut L · draw a line with two clicks',
  tipRect: 'Shortcut R · drag to draw a rectangle',
  tipEllipse: 'Shortcut O · drag to draw an ellipse',
  tipCircle: 'Shortcut C · click center, then set radius',
  tipPolyline: 'Shortcut P · multi-point polyline, Enter to finish',
  tipPen: 'Shortcut B · click anchors, drag for Bezier handles; Enter to finish, click start to close',
  tipBrush: 'Shortcut W · click-drag freehand strokes',
  tipText: 'Shortcut T · click the canvas to type text',
  tipImage: 'Shortcut I · pick a file, then click the canvas to place; drag & drop also works',
  fit: 'Fit view',
  process: 'Process',
  undo: 'Undo',
  redo: 'Redo',
  unit: 'Unit',
  grid: 'Grid',
  rulers: 'Rulers',
  workArea: 'Work area',
  workAreaUnbounded: 'Unbounded',
  workAreaPage: 'Page',
  workAreaSize: 'Size',
  group: 'Group',
  ungroup: 'Ungroup',
  hitMode: 'Hit mode',
  hitModeBounds: 'Inside AABB',
  hitModeGeometry: 'Geometry only',
  alignSnap: 'Align snap',
  angleSnap: 'Angle snap',
  tipGroup: 'Group the current multi-selection',
  tipUngroup: 'Ungroup the selected group',
  runBench: 'Run spike benchmark',
  benchIdle: 'Benchmark idle',
  benchRunning: 'Running spike…',
  benchDone: 'Spike done',
  genLines: 'Generating 1,000,000 lines…',
  genSquares: 'Generating 1,000,000 squares…',
  metricsBackend: 'backend',
  metricsUnit: 'unit',
  metricsFrame: 'frame',
  metricsVisible: 'visible',
  metricsDraws: 'draws',
  metricsUpload: 'upload',
  metricsTool: 'tool',
  metricsZoom: 'zoom',
  newDoc: 'New',
  fileMenu: 'File',
  newProject: 'New project',
  importFile: 'Import file',
  tipImportFile: 'Import SVG, DXF, or images into the document',
  importSvg: 'Import SVG',
  importDxf: 'Import DXF',
  importImage: 'Import image',
  imageUrl: 'Image URL',
  exportSvg: 'Export SVG',
  exportJson: 'Export JSON',
  sideSlotHint: 'Reserved side panel',
  offset: 'Offset',
  offsetDirection: 'Direction',
  offsetExternal: 'External',
  offsetInner: 'Inner',
  offsetCorner: 'Corner style',
  offsetDistance: 'Offset distance',
  offsetOuterOnly: 'Outer shapes only',
  offsetPrecision: 'Precision',
  cancel: 'Cancel',
  confirm: 'Confirm',
  offsetNeedSelection: 'Select an object to offset',
  boolean: 'Boolean',
  booleanUnion: 'Union',
  booleanSubtract: 'Subtract',
  booleanIntersect: 'Intersect',
  booleanExclude: 'Exclude',
  booleanNeedSelection: 'Select at least two closed shapes',
  tipBooleanSubtract: 'Subtract: first selected minus the rest',
  curveText: 'Curve text',
  curveTextEnable: 'Follow arc',
  curveTextHint: 'Places an arc around the text center (midpoint on the apex). Radius and angles are adjustable.',
  settings: 'Settings',
  settingsDocument: 'Document',
  settingsGuides: 'Guides',
  settingsLanguage: 'Language',
  settingsImport: 'Import resolution',
  settingsImportHint: 'Applies to files imported after this change; existing objects are unchanged.',
  appMenu: 'App menu',
  imageDpi: 'Image DPI',
  svgDpi: 'SVG DPI',
  settingsDpiReset: 'Reset defaults (96 / 72)',
  layers: 'Layers',
  layersHint: 'Drag ⋮⋮ to reorder layers; drag objects onto a layer to move them.',
  layer: 'Layer',
  layerAdd: 'Add layer',
  layerDelete: 'Delete layer',
  layerColor: 'Layer color',
  layerVisible: 'Visible',
  layerActive: 'Active',
  layerMoveSelection: 'Move selection to active layer',
  layerReorder: 'Drag to reorder layers',
  layerDropHint: 'Drag onto another layer to move',
  layerGcode: 'Engrave params',
  layerGcodeEmpty: 'Select a layer in the layers panel to edit GRBL / G-code parameters.',
  layerGcodeHint: 'Layer-only settings for future G-code export; not used for canvas rendering.',
  engraveMode: 'Engrave mode',
  engraveLine: 'Line',
  engraveFill: 'Fill',
  lineSpacing: 'Line spacing',
  fillStyle: 'Fill path style',
  fillBidirectional: 'Bi-directional Fill',
  fillCrossHatch: 'Cross-Hatch',
  fillShapesIndividually: 'Fill Shapes Individually',
  fillOffset: 'Offset Fill',
  machineParams: 'Machine',
  laserPower: 'Power',
  feedSpeed: 'Speed',
  passes: 'Passes',
  devMenu: 'Dev',
  devBack: 'Back',
  devHint: 'Developer tools: stress tests and seed data. Does not dispose the editor.',
  devWarn: 'Million-entity generators may use a lot of memory.',
  confirmNew: 'Clear the document and start fresh?',
  importing: 'Importing…',
  importFailed: 'Import failed',
  exported: 'Exported',
  promptImageUrl: 'Enter image URL',
  stroke: 'Stroke',
  fill: 'Fill',
  fontSize: 'Font size',
  arcText: 'Arc text',
  arcRadius: 'Radius',
  arcStart: 'Start °',
  arcSweep: 'Sweep °',
  arcBaseline: 'Baseline',
  arcOuter: 'Outer',
  arcInner: 'Inner',
  noSelection: 'No selection',
  inspector: 'Inspector',
  inspectorEmpty: 'Select an object to edit properties',
  selected: 'selected',
  style: 'Style',
  text: 'Text',
  content: 'Content',
  image: 'Image',
  size: 'Size',
  transform: 'Transform',
  boundsHint: 'Position/size from bounds (read-only for some types)',
  effects: 'Effects',
  effectsDisabled: 'Select a single image to edit the filter stack',
  effectsHint: 'Builtin and custom WGSL filters applied in order',
  addFilter: 'Add',
  resetFilters: 'Reset',
  noFilters: 'No filters',
  customWgsl: 'Custom WGSL',
  validateWgsl: 'Validate',
  addCustomFilter: 'Add custom',
  compileIdle: 'Not validated yet',
  compileOk: 'Validation passed',
  'cat.Editing': 'Editing',
  'cat.Guides': 'Guides',
  'cat.Camera': 'Camera',
  'cat.Groups': 'Groups',
  'cat.SVG': 'SVG',
  'cat.DXF': 'DXF',
  'cat.Text': 'Text',
  'cat.Geometry': 'Geometry',
  'cat.Performance': 'Performance',
  'ex.basic.title': 'Basic lines',
  'ex.basic.desc': 'Rulers + grid + interactive lines',
  'ex.guides.title': 'Rulers & grid',
  'ex.guides.desc': 'Figma-style rulers, unit switch, grid',
  'ex.camera.title': 'Zoom & pan',
  'ex.camera.desc': 'zoomAt / pan / fitView demo',
  'ex.groups.title': 'Groups',
  'ex.groups.desc': 'Group-matrix rotate/scale; children keep local geometry',
  'ex.svg.title': 'SVG import',
  'ex.svg.desc': 'svg-pathdata path expansion',
  'ex.dxf.title': 'DXF import',
  'ex.dxf.desc': 'dxf-render parse + unit conversion',
  'ex.text.title': 'Vector text',
  'ex.text.desc': 'Text shaping and LOD',
  'ex.large-coords.title': 'Large coordinates',
  'ex.large-coords.desc': 'Float64 world coordinates',
  'ex.million-lines.title': '1M lines',
  'ex.million-lines.desc': 'Generate 1e6 lines and measure frame time',
  'ex.million-squares.title': '1M squares',
  'ex.million-squares.desc': 'Generate 1e6 closed squares and watch FPS',
  'ex.benchmark.title': 'Spike benchmark',
  'ex.benchmark.desc': '1M squares WebGPU FPS / CPU / memory report',
  'spike.title': 'Tech spike report (WebGPU · 1M squares)',
  'spike.generated': 'Generated at',
  'spike.webgpu': 'WebGPU',
  'spike.available': 'available',
  'spike.unavailable': 'unavailable',
  'spike.targets': 'Frozen targets',
  'spike.results': 'Results',
  'spike.note':
    'Notes: FPS is derived from frame time; CPU busy = (build+render)/wall; Heap from performance.memory (Chromium).',
  'spike.col.case': 'Case',
  'spike.col.backend': 'Backend',
  'spike.col.entities': 'Entities',
  'spike.col.build': 'Build ms',
  'spike.col.p95': 'Frame p95',
  'spike.col.fpsAvg': 'FPS avg',
  'spike.col.fpsMin': 'FPS min',
  'spike.col.cpu': 'CPU busy',
  'spike.col.heapUsed': 'Heap used MB',
  'spike.col.heapTotal': 'Heap total MB',
  'spike.col.draws': 'Draws',
  'spike.col.upload': 'Upload MB',
  'spike.col.notes': 'Notes',
}

export const LOCALES: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zh,
  'en-US': en,
}

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
}

export const DEFAULT_LOCALE: Locale = 'zh-CN'
