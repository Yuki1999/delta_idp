# 报关资料关键信息抽取 Skill

## 使用场景

当用户上传或指定商业发票、装箱单、报关资料、物流单据时，必须使用本 Skill。

## 强制执行顺序

### Step 1. 读取文件

如果用户提供文件路径或文件名，必须先调用 `read_document` 工具。

该工具会调用 `scripts/read_document.py` 完整解析 xlsx 文件，输出包含所有行、所有单元格的结构化文本。ITEM 明细行会逐行标记为 `ITEM_DATA`，保证一行不漏。

**禁止在没有读取文件内容的情况下直接抽取。**

### Step 2. 获取模板

调用 `list_extraction_templates` 工具，获取系统可用模板（只需关注：模板名称、document_type、vendor、description）。

### Step 3. 匹配模板

根据文档内容匹配：
- 含金额/币制/贸易条款/单价/总价 → invoice
- 含箱号/毛重/净重/体积/包装方式 → packing_list
- 单据号 DS/ES 开头或发货方含 SAMSUNG → samsung
- 其他 → generic

### Step 4. 抽取主字段

按模板字段分组抽取：客户信息、贸易主体、物流信息、发票信息、系统字段。

缺失字段填 null，不得编造。

### Step 5. 抽取 ITEM 明细（最高优先级）

从 read_document 输出的 `ITEM_DATA` 行中提取所有明细。

**关键规则**：
- 文档有多少行 ITEM_DATA，输出就必须有多少行
- **绝对禁止省略、合并、截断或使用 "..." 代替**
- 最后加合计行

装箱单明细列：序号 | 箱号 | 产品编号 | 品名 | 数量 | 毛重(kg) | 净重(kg) | 体积(CBM)
发票明细列：序号 | 订单号 | 产品编号 | 品名 | 数量 | 单价 | 金额

无明细则注明「本文档无明细数据」。

### Step 6. 输出

Markdown 表格，按分组输出。重量 3 位小数，体积 4 位，金额 2 位。缺失字段为 null。置信度：高/中/低。

## 可用工具

- `read_document` — 调用 `scripts/read_document.py`，完整解析 xlsx，输出含 ITEM_DATA 标记的结构化文本
- `list_extraction_templates` — 列出系统可用模板
