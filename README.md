# sysmon-ipk

`sysmon-ipk` 是一个面向 OpenWrt 的系统监控面板项目，前端使用 React + Vite，后端使用 Flask，最终打包为可直接安装的 `.ipk` 包。

安装后会在路由器上启动一个 Web 服务，用于展示 CPU、内存、磁盘、网络、Docker、温度传感器和关键系统服务状态。

## 项目特性

- 实时采集 CPU 使用率、温度和负载
- 展示内存使用情况、缓存和缓冲区占用
- 展示根分区和 `/data` 分区占用情况
- 统计上下行速率与 TCP 连接数
- 展示 Docker 容器状态、镜像、端口、CPU 和内存占用
- 读取温度传感器与风扇转速信息
- 检测 OpenWrt 常见核心服务运行状态
- 通过 `/etc/init.d/sysmon` 接入 OpenWrt 服务管理
- 前端构建产物直接内置到包内，安装后即可访问

## 适用场景

- 在 OpenWrt 设备上快速部署一个轻量级本地监控面板
- 作为自定义路由器控制台或 NAS 监控首页
- 二次开发自己的监控前端或采集接口

## 技术栈

- 前端：React 18、Vite、Tailwind CSS、lucide-react
- 后端：Python 3、Flask
- 打包：Shell 脚本 + OpenWrt `.ipk` 目录结构
- 服务管理：`procd` + `init.d`

## 项目结构

```text
sysmon-ipk/
├── backend/
│   ├── sysmon-server.py      # Flask 后端服务
│   └── static/               # 前端构建产物
├── frontend/                 # React 前端源码
├── init.d/sysmon             # OpenWrt 服务脚本
├── config/sysmon             # OpenWrt UCI 默认配置
├── control/control           # ipk 控制信息
├── build-ipk.sh              # 一键打包脚本
├── sysmon-server.js          # 早期 Node.js 原型版本，当前打包未使用
└── README.md
```

## 当前包信息

- 包名：`sysmon-server`
- 当前版本：`2.0.0`
- 当前架构：`x86_64`
- 默认端口：`8999`
- 当前构建产物：`sysmon-server_2.0.0_x86_64.ipk`

## 本地开发

### 1. 启动后端

在项目根目录执行：

```sh
python3 backend/sysmon-server.py
```

默认监听：

```text
http://127.0.0.1:8999
```

也可以通过环境变量指定端口：

```sh
SYSMON_PORT=8999 python3 backend/sysmon-server.py
```

### 2. 启动前端开发服务器

```sh
cd frontend
npm install
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:5173
```

Vite 已配置 `/api` 代理到本地 `8999` 端口，因此开发环境下前端会自动请求 Flask 后端。

## 构建 `.ipk` 包

### 依赖要求

- Node.js / npm
- GNU tar
- macOS 下建议安装 `gtar`

macOS 可使用：

```sh
brew install gnu-tar
```

### 执行打包

在项目根目录执行：

```sh
./build-ipk.sh
```

打包脚本会完成以下工作：

1. 构建前端静态资源
2. 组装 OpenWrt 包目录结构
3. 写入 `postinst` / `prerm`
4. 输出最终 `.ipk` 文件到项目根目录

生成文件示例：

```text
sysmon-server_2.0.0_x86_64.ipk
```

## 在 OpenWrt 上安装

### 运行时依赖

当前包的依赖如下：

- `python3`
- `python3-flask`
- `python3-blinker`

如果目标设备缺少依赖，可先执行：

```sh
opkg update
opkg install python3 python3-flask python3-blinker
```

### 安装包

将 `.ipk` 上传到设备后执行：

```sh
opkg install ./sysmon-server_2.0.0_x86_64.ipk
```

安装完成后，`postinst` 会自动：

- 启用 `sysmon` 服务
- 启动 `sysmon` 服务

### 常用服务命令

```sh
/etc/init.d/sysmon enable
/etc/init.d/sysmon start
/etc/init.d/sysmon stop
/etc/init.d/sysmon restart
/etc/init.d/sysmon status
```

默认访问地址：

```text
http://<路由器IP>:8999/
```

## 配置说明

默认配置文件：

```text
/etc/config/sysmon
```

默认内容：

```uci
config sysmon 'main'
	option port '8999'
```

如需修改端口：

```sh
uci set sysmon.main.port='9000'
uci commit sysmon
/etc/init.d/sysmon restart
```

## API 说明

后端当前暴露一个主要接口：

### `GET /api/stats`

返回聚合后的系统状态，主要字段包括：

- `cpu`
- `memory`
- `storage`
- `network`
- `docker`
- `thermal`
- `services`
- `binaryNoise`
- `uptime`

适合前端面板直接轮询，也适合后续扩展为其他客户端调用。

## 数据来源

项目主要通过以下方式读取系统信息：

- `/proc/stat`、`/proc/loadavg`
- `/proc/meminfo`
- `/proc/net/dev`、`/proc/net/sockstat`
- `/proc/uptime`
- `/sys/class/thermal/*`
- `/sys/class/hwmon/*`
- `df -k`
- `docker ps`
- `docker stats --no-stream`
- `/etc/init.d/*`

## 已知限制

- 当前 `control/control` 和打包脚本中架构写死为 `x86_64`，如果要适配其他 OpenWrt 设备，需要同步修改架构字段和产物命名。
- Docker 相关信息依赖目标设备已安装并运行 Docker；未安装时对应面板会显示为空。
- 温度和风扇信息依赖内核和硬件暴露的 `sysfs` 节点；部分设备不会返回数据。
- “自由排版”当前只在前端内存中生效，刷新页面后不会持久化。
- 根分区和 `/data` 分区展示逻辑是按固定挂载点读取，设备分区结构不一致时需要自行调整。

## 二次开发建议

- 如果要扩展采集项，优先在 `backend/sysmon-server.py` 中增加字段，再同步更新 `frontend/src/App.jsx`。
- 如果要接入认证、ACL 或反向代理，建议在 OpenWrt 上用现有 Web 入口统一代理该服务。
- 如果要支持更多架构，建议把架构参数从 `build-ipk.sh` 和 `control/control` 中提取为可配置变量。

## 后续可补充项

这个仓库目前已经具备可运行、可打包、可安装的基本条件。如果后续要继续完善，优先级建议如下：

1. 增加多架构打包支持
2. 增加截图或演示 GIF
3. 增加布局持久化
4. 增加权限控制或登录能力
5. 增加发布说明和变更记录
