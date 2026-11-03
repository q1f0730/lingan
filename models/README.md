# models

拾穗 · Glean 的端侧小模型，App 里「设置 → 本机向量」按需下载，不打进安装包。

## mini-zh-v1.bin（约 8.8MB）

- 来源：[minishlab/potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M)（model2vec 静态向量，MIT License，© Minish Lab），分词表来自 BAAI/bge-m3（MIT License）。
- 裁剪：只留中文词元 19017 个 + 最常用的英文 / 数字词元 12000 个 + 常用标点 1500 个，共 32517 个；256 维，每行 int8 量化 + 一个缩放系数。
- 格式（小端）：`GM1\0`，u32 词元数 n，u32 维度 d，u32 词表字节数 b；词表 UTF-8（`\n` 分隔，补齐到 4 字节）；f32 分数 × n（Unigram 分词用）；f32 缩放 × n；i8 向量 n × d。
- 用法：NFKC → 开头加 `▁`、空格换 `▁` → Unigram（Viterbi）分词 → 词元向量取平均 → 归一化。
- SHA-256：`34ac606785ca9f6321807169811905d268b64fa9b199d86015db7e56a8f493d1`（App 下载后核对，不一致就丢掉）。

构建脚本：scripts/mini/build.py（要先下载原模型的 tokenizer.json 与 model.safetensors）。下载地址固定到发版 tag：jsDelivr `cdn.jsdelivr.net/gh/q1f0730/lingan@v0.38.0/models/mini-zh-v1.bin`，备用 raw.githubusercontent.com。署名 Q1f730。
