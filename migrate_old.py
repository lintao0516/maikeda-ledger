# -*- coding: utf-8 -*-
"""把旧资料库后台表(tM4nETqvGu1P6xxpjyT3gS)里的真实凭证迁移到本地共享后端。
旧表字段为扁平中文：摘要/收支类型/日期/科目/经手人/账户/金额
新后端 POST /api/ledger 接受同名字段（日期存 YYYY-MM-DD）。
"""
import json, urllib.request

SRC = r"C:/Users/Lenovo-baiyin/WorkBuddy/财务/ledger-server/_old_ledger.json"
API = "http://localhost:3000/api/ledger"

data = json.load(open(SRC, encoding="utf-8"))
rows = data.get("results", [])
print("从旧表读取凭证:", len(rows))

migrated = 0
for r in rows:
    iso = r.get("日期", "") or ""
    date = iso[:10] if iso else ""
    payload = {
        "日期": date,
        "收支类型": r.get("收支类型", "支出"),
        "科目": r.get("科目", ""),
        "金额": float(r.get("金额", 0) or 0),
        "账户": r.get("账户", "") or "现金",
        "摘要": r.get("摘要", ""),
        "经手人": r.get("经手人", "") or "",
    }
    if not payload["科目"] or not payload["日期"]:
        print("  跳过(缺科目/日期):", r.get("record_id"))
        continue
    req = urllib.request.Request(API, data=json.dumps(payload).encode("utf-8"),
                                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            rec = json.loads(resp.read().decode("utf-8"))
            migrated += 1
            print(f"  已迁移: {rec['日期']} {rec['收支类型']} {rec['科目']} {rec['金额']} 摘要={rec['摘要']}")
    except Exception as e:
        print("  迁移失败:", payload, "->", e)

print("本次迁移成功条数:", migrated)
