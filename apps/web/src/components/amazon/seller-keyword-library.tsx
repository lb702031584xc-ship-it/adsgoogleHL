"use client";

/**
 * 卖家工具 P1 关键词库面板（方案第 3 节：关键词库表结构）。
 * 数据只存浏览器 localStorage（键 adlinklab-seller-tool-keywords-v1），
 * 后续的文案、埋词、校验切片复用同一键。
 *
 * 本面板不含搜索量（需 ABA 资格或工具数据另查，绝不编造）；ST 生成器
 * 只做词根去重与字符/字节计数，不做词干还原，不猜单复数同根。
 */
import { useEffect, useMemo, useState } from "react";
import {
  KEYWORD_TYPES,
  ST_BYTE_LIMIT,
  ST_CHAR_LIMIT,
  buildSearchTerms,
  type KeywordEntry,
  type KeywordType,
} from "@/lib/amazon/keyword-st";

const KEYWORDS_KEY = "adlinklab-seller-tool-keywords-v1";

function newId(): string {
  return `kw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isKeywordType(v: string): v is KeywordType {
  return (KEYWORD_TYPES as readonly string[]).includes(v);
}

export function SellerKeywordLibrary({
  products,
}: {
  products: { id: string; name: string }[];
}) {
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filterType, setFilterType] = useState<"全部" | KeywordType>("全部");
  const [filterProduct, setFilterProduct] = useState<string>("全部");
  const [newTerm, setNewTerm] = useState("");
  const [newType, setNewType] = useState<KeywordType>("产品词");
  const [newSource, setNewSource] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newProductId, setNewProductId] = useState<string>("");
  const [bulkText, setBulkText] = useState("");
  const [bulkType, setBulkType] = useState<KeywordType>("产品词");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEYWORDS_KEY);
      if (raw) setEntries(JSON.parse(raw) as KeywordEntry[]);
    } catch {
      // 本地数据损坏时从空开始，不阻塞页面。
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEYWORDS_KEY, JSON.stringify(entries));
    } catch {
      // 隐私模式等写不进 localStorage 时只影响本地保存，不影响当次使用。
    }
  }, [entries, loaded]);

  const productName = (id: string | null): string => {
    if (!id) return "通用";
    return products.find((p) => p.id === id)?.name ?? "已删除商品";
  };

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterType !== "全部" && e.type !== filterType) return false;
      if (filterProduct === "通用") return e.productId === null;
      if (filterProduct !== "全部" && e.productId !== filterProduct) return false;
      return true;
    });
  }, [entries, filterType, filterProduct]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [entries]);

  const addOne = (term: string, type: KeywordType, productId: string | null): boolean => {
    const t = term.trim();
    if (!t) return false;
    const dup = entries.some(
      (e) => e.term.trim().toLowerCase() === t.toLowerCase() && e.productId === productId
    );
    if (dup) return false;
    setEntries((prev) => [
      {
        id: newId(),
        term: t,
        type,
        source: newSource.trim(),
        note: newNote.trim(),
        productId,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    return true;
  };

  const addSingle = () => {
    if (!addOne(newTerm, newType, newProductId || null)) {
      if (newTerm.trim()) alert("该词已在库（同词 + 同商品），未重复添加。");
      return;
    }
    setNewTerm("");
    setNewNote("");
  };

  const addBulk = () => {
    let added = 0;
    let skipped = 0;
    const lines = bulkText.split("\n");
    const next: KeywordEntry[] = [];
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      // 每行格式：词 或 词|类型（类型须为 10 类之一，否则用批量类型）。
      const [termPart, typePart] = raw.split("|").map((s) => s.trim());
      const type = typePart && isKeywordType(typePart) ? typePart : bulkType;
      const t = termPart;
      if (!t) {
        skipped += 1;
        continue;
      }
      const dup =
        entries.some(
          (e) => e.term.trim().toLowerCase() === t.toLowerCase() && e.productId === null
        ) || next.some((e) => e.term.trim().toLowerCase() === t.toLowerCase());
      if (dup) {
        skipped += 1;
        continue;
      }
      next.push({
        id: newId(),
        term: t,
        type,
        source: newSource.trim(),
        note: "",
        productId: null,
        createdAt: Date.now(),
      });
    }
    if (next.length > 0) setEntries((prev) => [...next, ...prev]);
    added = next.length;
    setBulkText("");
    alert(`批量导入 ${added} 条${skipped > 0 ? `，跳过重复/空行 ${skipped} 条` : ""}（批量导入的词默认为通用词）。`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedTerms = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e.term]));
    return selectedIds.map((id) => byId.get(id)).filter((t): t is string => !!t);
  }, [entries, selectedIds]);

  const st = useMemo(() => buildSearchTerms(selectedTerms), [selectedTerms]);

  const copySt = async () => {
    if (!st.text) return;
    try {
      await navigator.clipboard.writeText(st.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("复制失败，请手动复制下方文本。");
    }
  };

  return (
    <div className="rounded-lg border border-ink/10 p-4">
      <h2 className="font-semibold">关键词库（P1：为 Listing 文案与校验供词）</h2>
      <p className="mt-1 text-xs text-ink/55">
        词条只存浏览器本地，与潜力库同一台机器。类型按方案 10 类：产品词、品牌词、属性词、
        材质词、形状词、功能词、场景词、受众词、节日词、广告高转化词。词库不含搜索量——搜索量
        需 ABA 资格或工具数据另查，来源栏可填 ABA / 广告报告 / 竞品标题 / 手动。ST 生成器只做
        词根去重与计数，不做词干还原；字符与字节两项都标（课程对 250 字符与 250 字节说法不一，
        亚马逊后台实际按字节计，超字节标红、仅超字符标黄）。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)}
          placeholder="词，如：slow feeder bowl"
          className="rounded border border-ink/20 px-2 py-1.5 text-sm" />
        <select value={newType} onChange={(e) => setNewType(e.target.value as KeywordType)}
          className="rounded border border-ink/20 px-2 py-1.5 text-sm">
          {KEYWORD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={newProductId} onChange={(e) => setNewProductId(e.target.value)}
          className="rounded border border-ink/20 px-2 py-1.5 text-sm">
          <option value="">通用词</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input value={newSource} onChange={(e) => setNewSource(e.target.value)}
          placeholder="来源，如：ABA / 竞品标题"
          className="rounded border border-ink/20 px-2 py-1.5 text-sm" />
        <input value={newNote} onChange={(e) => setNewNote(e.target.value)}
          placeholder="备注（可选）"
          className="rounded border border-ink/20 px-2 py-1.5 text-sm" />
        <button type="button" onClick={addSingle}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white">添加</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
          placeholder={"批量导入：每行一个词，或“词|类型”（类型须为 10 类之一，否则用批量类型）。\n如：\nslow feeder bowl|产品词\nsilicone|材质词"}
          className="w-full rounded border border-ink/20 px-2 py-1.5 text-sm md:w-96" rows={4} />
        <div className="flex flex-col gap-2">
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value as KeywordType)}
            className="rounded border border-ink/20 px-2 py-1.5 text-sm">
            {KEYWORD_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button type="button" onClick={addBulk}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white">批量导入（通用词）</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as "全部" | KeywordType)}
          className="rounded border border-ink/20 px-2 py-1 text-sm">
          <option value="全部">全部类型</option>
          {KEYWORD_TYPES.map((t) => (
            <option key={t} value={t}>{t}（{typeCounts.get(t) ?? 0}）</option>
          ))}
        </select>
        <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}
          className="rounded border border-ink/20 px-2 py-1 text-sm">
          <option value="全部">全部商品</option>
          <option value="通用">通用词</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="self-center text-xs text-ink/55">
          共 {entries.length} 条，本页 {filtered.length} 条，ST 已选 {selectedIds.length} 条
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-ink/55">暂无词条。先从竞品标题、ABA 或广告报告里摘词加进来，再用下面的 ST 生成器拼 Search Terms。</p>
      ) : (
        <div className="mt-3 space-y-1">
          <button type="button"
            onClick={() => {
              const ids = filtered.map((e) => e.id);
              setSelectedIds((prev) =>
                ids.every((id) => prev.includes(id))
                  ? prev.filter((id) => !ids.includes(id))
                  : [...new Set([...prev, ...ids])]
              );
            }}
            className="rounded-lg border border-ink/20 px-3 py-1 text-sm">
            全选 / 取消全选本页
          </button>
          {filtered.map((e) => (
            <label key={e.id} className="flex items-start gap-2 rounded border border-ink/10 px-2 py-1 text-sm">
              <input type="checkbox" checked={selectedIds.includes(e.id)}
                onChange={() => toggleSelect(e.id)} className="mt-1" />
              <span className="flex-1">
                <span className="font-medium">{e.term}</span>
                <span className="text-ink/55"> · {e.type} · {productName(e.productId)}</span>
                {e.source && <span className="text-ink/55"> · 来源：{e.source}</span>}
                {e.note && <span className="text-ink/55"> · {e.note}</span>}
              </span>
              <button type="button"
                onClick={() => {
                  setEntries((prev) => prev.filter((x) => x.id !== e.id));
                  setSelectedIds((prev) => prev.filter((id) => id !== e.id));
                }}
                className="text-red-700">删除</button>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 rounded border border-ink/10 p-3">
        <h3 className="font-medium">ST 生成器（Search Terms：词根去重 + 计数）</h3>
        <textarea readOnly value={st.text} rows={3}
          placeholder="勾选上方词条后，这里生成去重后的 Search Terms。"
          className="mt-2 w-full rounded border border-ink/20 px-2 py-1.5 text-sm" />
        <p className="mt-1 text-xs text-ink/55">
          字符 {st.charCount} / {ST_CHAR_LIMIT} · 字节 {st.byteCount} / {ST_BYTE_LIMIT} · 剩余字节 {ST_BYTE_LIMIT - st.byteCount}
        </p>
        {st.overBytes && (
          <p className="mt-1 text-sm text-red-700">已超 250 字节上限：请减少词条或拆词后再生成。</p>
        )}
        {!st.overBytes && st.overChars && (
          <p className="mt-1 text-sm text-amber-700">字符数超 250，但字节未超：课程对字符与字节说法不一，亚马逊后台按字节计，此处仅提醒。</p>
        )}
        <button type="button" onClick={copySt} disabled={!st.text}
          className="mt-2 rounded-lg border border-ink/20 px-3 py-1 text-sm disabled:opacity-50">
          {copied ? "已复制" : "复制 ST"}
        </button>
      </div>
    </div>
  );
}
