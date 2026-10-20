# 双版对照 · 分屏同步

同一个"玻璃立方体云鲸"主题的两种独立实现并排显示，共用一套相机：拖拽、缩放、翻面实时同步。

- **左** — 初版实现（`left/`）：星尘云鲸、发光浮岛、程序化地形
- **右** — 重写版（`right/`）：参数化躯干云鲸、半透明材质、极坐标地形

## 快速开始

```bash
npm install          # 安装 three / esbuild / puppeteer-core，并自动生成 vendor/
npm start            # = python serve.py 5173
```

打开 **http://127.0.0.1:5173/host/index.html**

局域网访问（手机、其他电脑）：

```bash
npm run serve:lan    # 绑定 0.0.0.0，终端会打印本机 IP
```

必须走 http：两个 iframe 加载 ES module，`file://` 会被 CORS 拦。

### 手动布置（不用 npm）

如果只想看效果，需要三样：

1. 两个页面目录 `left/` `right/` 原样放着
2. `vendor/build/three.module.js` 和 `vendor/examples/jsm/`（从 `node_modules/three` 复制即可）
3. 一个多线程静态服务器指到仓库根目录（单线程的 `python -m http.server` 会因并行加载 25 MB 模块而失败）

`python serve.py 5173` 满足第 3 点。

## 操作

| 输入 | 效果 |
| --- | --- |
| 拖拽任一侧 | 环绕旋转，两侧一起转 |
| 滚轮 / 双指 | 缩放，k 0.85–9.6 |
| `1` / `2` / `0` | 只看左边 / 只看右边 / 恢复双屏 |
| 空闲 4.5 秒 | 恢复自动巡航（由宿主统一驱动） |

鼠标在任一半边都生效——宿主捕获整个舞台的指针事件，转发给两侧。

## 结构

```
split-compare/
  host/index.html       双 iframe 宿主 + 相机状态 + 输入 + 自动巡航
  left/                 左屏（index.html + main.js，原生 ES module）
  right/scene.html      右屏打包产物（单文件，开箱即用）
  right/src/            右屏源码（十一个模块）
  right/build.mjs       esbuild 打包脚本
  scripts/vendor-three.mjs  从 node_modules 生成 vendor/
  serve.py              多线程静态服务器
  verify.mjs            交互断言脚本
  vendor/               不提交，npm install 时生成（three build + examples）
```

## 同步是怎么做的

两个场景的物理尺度差 8.7 倍（立方体半边 5 vs 0.745），fov 也不同（28° vs 26°）。直接同步相机距离没有意义，所以统一到归一化坐标：

- **yaw / pitch** — 绝对弧度，两侧完全一致
- **k** — 相机距离 ÷ 立方体半对角线

子页面各自把 k 换算成自己的世界距离。为了让投影大小真正对齐，还乘了 fov 补偿：

```
dist = halfDiag × k × tan(27°) / tan(fov/2)
```

27° 是两边共用的参考 fov。这一步是必需的，否则 fov 大的那侧画面会明显更广。

### 子页面接口

两侧都暴露 `window.__view`：

```js
{
  side: 'left' | 'right',
  fov, halfDiag, camera,
  apply(yaw, pitch, k)   // 宿主每帧或每次输入调用
}
```

左侧以 `?embed=1` 打开时：`controls.enabled = false`、关掉阻尼与自动旋转、`controls.update()` 不再执行（它的 minDistance/maxDistance 钳制会覆盖宿主推来的值）。

右侧以 `?embed=1` 打开时：`canvas.style.pointerEvents = 'none'`、intro 运镜短路、世界浮动冻结。

## 已知差异（不是 bug）

- **两侧内容占满率不同。** 左屏岛小、鲸鱼大，画面填得满；右屏岛占底部 1/3，上方留给云鲸。立方体外框是等大的，内部构图是各自的设计。
- **同一相机角度框到不同内容。** 转到某些角度，左边看雪山、右边看森林。这是两个场景布局不同导致的，同步的是相机不是内容。
- **右屏玻璃几乎看不见。** 原设计就是"克制到几乎透明的玻璃"，未做增强。
- **pitch 两侧差 0.004 rad。** 因为 lookAt 目标点不同（左 (0,-0.2,0)，右 (0,0.03,0)），从相机位置反推的角度有极小偏差。

## 验证

```bash
node verify.mjs
```

需要服务器在跑。检查项：两侧接口存在、几何尺寸正确、初始 k 一致、左侧拖拽后两侧 k 仍一致、滚轮缩放、上下限钳制、pitch 可低于水平面、右侧拖拽也生效、`1` 键隐藏右屏、自动巡航恢复。

**注意**：`verify.mjs` 用 puppeteer + SwiftShader 软渲染，会吃满 CPU。只在必要时跑，跑完确认没有残留进程。

## 改源码后

右侧是打包产物，改 `right/src/` 之后重新打包：

```bash
npm run build:right
```

左侧是原生 ES module，改 `left/main.js` 直接生效（服务器已禁用缓存）。

## 依赖

| 包 | 用途 |
| --- | --- |
| `three` 0.170 | 两侧场景的渲染库 |
| `esbuild` | 打包右侧单文件产物 |
| `puppeteer-core` | `verify.mjs` 的无头验证（可选） |

`vendor/` 不进仓库：25 MB 的 three 构建产物由 `scripts/vendor-three.mjs` 从
`node_modules` 现场复制，`npm install` 后自动执行。

