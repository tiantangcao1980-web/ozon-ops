# Performance API 接入指引（P4 真拉数）

当前 `.secrets/ozon.env` 只有 Seller API 凭据，所以 `ozon ads sync` 走 `NO_CREDENTIALS` 分支。Performance 凭据到位后即可真拉广告数据；在此之前可以离线跑。

## 1. 拿凭据

1. 打开 <https://performance.ozon.ru>，用卖家账号登录。
2. 进入「Настройки / API」或应用管理，创建应用（client），得到：
   - `client_id`
   - `client_secret`（只显示一次）
3. 确认该应用有广告数据读取权限（кампании / статистика）。

## 2. 写入 `.secrets/ozon.env`

```
OZON_CLIENT_ID=...          # 已有
OZON_API_KEY=...            # 已有
OZON_PERF_CLIENT_ID=...
OZON_PERF_CLIENT_SECRET=...
```

注意：不要加 `< >` 或引号（配置解析会剥掉，但保持干净更好）。该文件已被 `.gitignore` 忽略。

## 3. 自检

```bash
node bin/ozon.mjs ads doctor
# 期望：凭据已配置 / 端点可达 / 认证成功（token 已获取）
node bin/ozon.mjs ads sync
# 期望：广告同步：N/M 个计划入库
node bin/ozon.mjs ads report
```

## 4. 没有凭据时的离线通道

```bash
# 广告按日数据（Performance 后台导出 CSV）
node bin/ozon.mjs ads import --file ads-daily.csv
node bin/ozon.mjs ads report / ads suggest

# 搜索词判定（规则 #1/#2/#4/#5/#8/#10 + §8 预算分配）
node bin/ozon.mjs ads decide --file raw/ads-sample.csv
```

## 5. 已知边界

- `/api/client/campaign` 只返回计划清单、没有按日指标；`ads sync` 不会因此伪造 `ads_daily` 行（有测试保证），按日数据仍以 CSV 导入为主。
- 认证失败（401）时 `ads doctor` 会打印原因；429 会自动退避（Retry-After 上限 60 秒）。
- 凭据只用于 `Authorization: Bearer`，不会写进日志/报告；`scripts/verify-secrets.mjs` 可做泄漏自检。
