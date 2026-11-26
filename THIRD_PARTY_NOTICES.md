# Orbit Portal 第三方声明

以下素材和依赖各自适用上游许可证。

## 星球贴图

**Solar System Scope / INOVE，CC BY 4.0。** 涵盖 `web/portal/textures/` 中的 9 张原始 JPEG，以及 `web/portal/textures/surfaces/` 中的 `core.png`、`git.png`、`doc.png`、`week.png`、`flow.png`、`gpu.png`、`bi.png` 和 `seek.png`。Orbit Portal 对原图做了球面投影、光照和大气效果处理。演示视频中出现的这些贴图也沿用此署名。 [素材来源](https://www.solarsystemscope.com/textures/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [文件清单与改动说明](web/portal/textures/README.md)

## 标题字体

**霞鹜文楷 LXGW WenKai Regular v1.250，SIL Open Font License 1.1。** `web/portal/mist-title.woff2` 是经字形子集化并转换为 WOFF2 的版本。随附的许可证保留了 LXGW 和 The Klee Project Authors 的版权声明。 [上游版本](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.250) · [完整许可证](web/portal/OFL.txt)

## Python 运行依赖

`pip install -r requirements.txt` 和 Docker 构建会从包索引安装运行依赖。随包安装的完整许可证可在各包的 `.dist-info` 目录中查看。下表列出直接依赖和当前 Python 3.12 环境解析到的间接依赖。 [直接依赖清单](requirements.txt)

| 包 | 许可证 | 上游 |
| --- | --- | --- |
| Flask | BSD-3-Clause | [Pallets](https://github.com/pallets/flask) |
| Gunicorn | MIT | [Gunicorn](https://github.com/benoitc/gunicorn) |
| Blinker | MIT | [Pallets-Eco](https://github.com/pallets-eco/blinker) |
| Click | BSD-3-Clause | [Pallets](https://github.com/pallets/click) |
| ItsDangerous | BSD-3-Clause | [Pallets](https://github.com/pallets/itsdangerous) |
| Jinja2 | BSD-3-Clause | [Pallets](https://github.com/pallets/jinja) |
| MarkupSafe | BSD-3-Clause | [Pallets](https://github.com/pallets/markupsafe) |
| Werkzeug | BSD-3-Clause | [Pallets](https://github.com/pallets/werkzeug) |
