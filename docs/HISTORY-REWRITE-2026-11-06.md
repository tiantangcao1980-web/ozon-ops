# Git 历史重写记录（2026-11-06）

## 为什么要重写

1. **浏览器 profile 被误提交**：`data/` 下有 961 个文件（Chrome 用户目录，含 `Cookies`、`Trust Tokens`，实测有 `.ozon.ru` 会话 cookie）。`git ls-files` 确认它们已被跟踪。
2. **文档自引用密钥片段**：验收文档里写了一个 Key 的 8 位片段，导致后续扫描误报。

真实 API Key 本身**从未进入 git**：重写前后 `git log -p --all | grep <key>` 都是空的。

## 做了什么

```bash
# 1) 停止跟踪 + 忽略
echo "data/" >> .gitignore
git rm -r --cached data
git commit -m "chore: stop tracking browser profile data (contains login cookies)"

# 2) 从全部历史移除 data/
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
  --index-filter "git rm -r --cached --ignore-unmatch data" --prune-empty -- --all

# 3) 清掉文档里的 key 片段后，同样方式再清一次
git filter-branch --force --tree-filter \
  "grep -rl '<片段>' . 2>/dev/null | xargs -r sed -i 's/<片段>/<打码>/g'" -- --all

# 4) 删备份 ref、过期 reflog、回收对象
git for-each-ref refs/original --format='%(refname)' | xargs -r -n1 git update-ref -d
git reflog expire --expire=now --all && git gc --prune=now
```

## 验证命令（可复跑）

```bash
git rev-list --all --objects | grep 'data/'          # 期望：无输出
git log -p --all | grep '<key 片段>'                  # 期望：无输出
git ls-files .secrets                                 # 期望：无输出
node scripts/verify-secrets.mjs                       # 期望：exit 0
```

## 影响

- **所有 commit SHA 已变化**；重写前的 SHA（如 `42f201e` 之前）不再存在。仓库无 remote，没有外部副本被污染。
- 未跟踪的 `outbox/`、`reports/`、`db/` 等目录未受影响。

## 需要人工做的事

1. **作废旧会话**：既然 `data/` 曾包含 `.ozon.ru` 的 Cookies，建议在 Ozon 卖家后台**退出所有设备/重置会话**，并重新登录本机浏览器 profile（若还要复用）。
2. 若这个仓库曾被打包/拷贝给他人，请通知对方删除旧副本（本机无 remote，默认只在你机器上）。
3. **不要**把 `.secrets/`、`data/`、`db/` 加回版本库；`.gitignore` 已覆盖。
4. 如果将来要公开这个仓库，先跑一遍 `node scripts/verify-secrets.mjs`。

## 隐私说明

本次重写只删除了浏览器 profile 与文档片段；业务代码、设计文档、测试、报告产物保持完整（`reports/`、`db/` 本来就不入库）。
