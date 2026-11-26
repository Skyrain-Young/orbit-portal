# Orbit Portal

Orbit Portal 是一个可自托管、可玩的星球导航页。把应用放上轨道，通过目录搜索，也可以触发流星、穿梭星空和创建星球。示例目录包含 Google、YouTube、GitHub、Wikipedia 等公开链接。

## 演示视频

https://github.com/user-attachments/assets/959c293a-de7e-4f76-bcb2-4a8ef68f77cd

[下载 1080p 原版（MP4）](https://github.com/Skyrain-Young/orbit-portal/releases/download/demo-video/Orbit-Portal-Demo-Final.mp4)

## 本地启动

使用 Python 3.12，前端无需构建。

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

打开 [首页](http://127.0.0.1:8080/) 或 [管理后台](http://127.0.0.1:8080/admin)。首次启动生成管理员密码，保存在 `data/initial-admin-password.txt`。可在后台「设置」修改密码。

按空格打开目录，直接打字搜索，点击首页字标切换轨道和列表。通过后台的「应用」管理链接，用「星系」调整轨道位置。

## 配置自己的目录

默认读取 `web/catalog.json` 初始化示例目录。希望从空目录开始时，在首次启动前设置 `ORBIT_EMPTY_CATALOG=1`。

```sh
ORBIT_EMPTY_CATALOG=1 .venv/bin/python server.py
```

应用目录、统计、玩家记录及管理员配置存放在本地 `data/`。可以用 `ORBIT_DATA_DIR` 或 `--data-dir` 指定其他目录。后续启动会沿用目录里的数据。使用后台添加应用、导入目录或下载备份。

在后台「设置」中修改站点名称和首页 Logo 文字。Logo 留空时跟随站点名称。

## Docker

```sh
docker compose up -d --build
docker compose exec orbit-portal cat /app/data/initial-admin-password.txt
```

Compose 默认只在本机监听 `127.0.0.1:8080`，数据存放在 `orbit-data` 卷。空目录启动使用 `ORBIT_EMPTY_CATALOG=1 docker compose up -d --build`。通过 HTTPS 反向代理提供访问时，设置 `ORBIT_COOKIE_SECURE=1`。

## 开发检查

安装 Python 依赖以及 Node.js 后，运行：

```sh
.venv/bin/python -m unittest discover -s tests -v
```

## 许可证

Orbit Portal 的代码和原创文档采用 MIT 许可证。 [LICENSE](LICENSE)

星球贴图、字体和运行依赖各自适用上游许可证。 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
