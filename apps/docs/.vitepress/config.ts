import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '指南', link: '/guide/getting-started' },
  { text: '架构', link: '/guide/architecture' },
  { text: 'API', link: '/api/editor' },
  { text: '性能', link: '/guide/performance' },
  { text: 'ADR', link: '/adr/0001-webgpu-first' },
]

const enNav = [
  { text: 'Guide', link: '/en/guide/getting-started' },
  { text: 'Architecture', link: '/en/guide/architecture' },
  { text: 'API', link: '/en/api/editor' },
  { text: 'Performance', link: '/en/guide/performance' },
  { text: 'ADR', link: '/en/adr/0001-webgpu-first' },
]

const zhSidebar = {
  '/guide/': [
    {
      text: '指南',
      items: [
        { text: '快速开始', link: '/guide/getting-started' },
        { text: '核心概念', link: '/guide/concepts' },
        { text: '架构', link: '/guide/architecture' },
        { text: '渲染与局部更新', link: '/guide/rendering' },
        { text: '坐标与相机', link: '/guide/coordinates' },
        { text: '尺子与网格', link: '/guide/guides' },
        { text: '交互与吸附', link: '/guide/interaction' },
        { text: '生命周期与配置', link: '/guide/lifecycle' },
        { text: '导入 / 导出', link: '/guide/io' },
        { text: '矢量文本', link: '/guide/text' },
        { text: '性能目标', link: '/guide/performance' },
        { text: '插件开发', link: '/guide/plugins' },
        { text: '部署与线程', link: '/guide/deployment' },
      ],
    },
  ],
  '/api/': [
    {
      text: 'API',
      items: [
        { text: 'createEditor', link: '/api/editor' },
        { text: '兼容矩阵', link: '/api/compat' },
      ],
    },
  ],
  '/adr/': [
    {
      text: 'ADR',
      items: [
        { text: '0001 WebGPU First', link: '/adr/0001-webgpu-first' },
        { text: '0002 Authority Model', link: '/adr/0002-authority-model' },
        { text: '0003 Worker ABI', link: '/adr/0003-worker-abi' },
      ],
    },
  ],
}

const enSidebar = {
  '/en/guide/': [
    {
      text: 'Guide',
      items: [
        { text: 'Getting Started', link: '/en/guide/getting-started' },
        { text: 'Concepts', link: '/en/guide/concepts' },
        { text: 'Architecture', link: '/en/guide/architecture' },
        { text: 'Rendering', link: '/en/guide/rendering' },
        { text: 'Coordinates & Camera', link: '/en/guide/coordinates' },
        { text: 'Rulers & Grid', link: '/en/guide/guides' },
        { text: 'Interaction & Snapping', link: '/en/guide/interaction' },
        { text: 'Lifecycle & Config', link: '/en/guide/lifecycle' },
        { text: 'Import / Export', link: '/en/guide/io' },
        { text: 'Vector Text', link: '/en/guide/text' },
        { text: 'Performance', link: '/en/guide/performance' },
        { text: 'Plugins', link: '/en/guide/plugins' },
        { text: 'Deployment', link: '/en/guide/deployment' },
      ],
    },
  ],
  '/en/api/': [
    {
      text: 'API',
      items: [
        { text: 'createEditor', link: '/en/api/editor' },
        { text: 'Compatibility', link: '/en/api/compat' },
      ],
    },
  ],
  '/en/adr/': [
    {
      text: 'ADR',
      items: [
        { text: '0001 WebGPU First', link: '/en/adr/0001-webgpu-first' },
        { text: '0002 Authority Model', link: '/en/adr/0002-authority-model' },
        { text: '0003 Worker ABI', link: '/en/adr/0003-worker-abi' },
      ],
    },
  ],
}

export default defineConfig({
  title: 'CADKit',
  lastUpdated: true,
  cleanUrls: true,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '给 Web 交付用的 CAD 画布框架 — WebGPU · Float64 · 制造向 I/O',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '上次更新' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        langMenuLabel: '切换语言',
        socialLinks: [{ icon: 'github', link: 'https://github.com/tetap/cadkit' }],
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'CAD canvas framework for the web — WebGPU · Float64 · manufacturing I/O',
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
        lastUpdated: { text: 'Last updated' },
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Theme',
        langMenuLabel: 'Change language',
        socialLinks: [{ icon: 'github', link: 'https://github.com/tetap/cadkit' }],
      },
    },
  },
})
