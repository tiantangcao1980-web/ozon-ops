/**
 * 类目树拉取与统计。
 * 线上实测：/v1/description-category/tree 返回 { result: [ { category..., children: [ { type..., children: [] } ] } ] }，
 * 叶子 = 没有 children 或 children 为空的节点。历史脚本报 leaf_count=0，先按真实快照复现（7,363）。
 */
export function countLeaves(tree) {
  let leaves = 0;
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      const children = node?.children ?? [];
      if (children.length === 0) leaves += 1;
      else walk(children);
    }
  };
  walk(Array.isArray(tree) ? tree : (tree?.result ?? []));
  return leaves;
}

function treeStats(tree) {
  let nodes = 0;
  let maxDepth = 0;
  const walk = (list, depth) => {
    for (const node of list ?? []) {
      nodes += 1;
      maxDepth = Math.max(maxDepth, depth);
      walk(node?.children ?? [], depth + 1);
    }
  };
  walk(Array.isArray(tree) ? tree : (tree?.result ?? []), 0);
  return { nodes, depth: maxDepth };
}

export async function pullCategories({ api, db, language = 'ZH_HANS', now = () => new Date().toISOString() }) {
  const response = await api.call('/v1/description-category/tree', { language });
  const tree = response.json?.result ?? response.json ?? [];
  const bytes = Buffer.byteLength(JSON.stringify(tree), 'utf8');
  const { nodes, depth } = treeStats(tree);
  const leaves = countLeaves(tree);

  db.setSetting('category_tree', JSON.stringify(tree));
  db.setSetting('category_tree_fetched_at', now());
  db.setSetting('category_tree_stats', JSON.stringify({ nodes, leaves, depth, bytes }));

  return { nodes, leaves, depth, bytes };
}
