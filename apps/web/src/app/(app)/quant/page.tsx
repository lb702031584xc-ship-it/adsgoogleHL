import {
  QUANT_DATA_AS_OF,
  QUANT_POOL_SIZE,
  QUANT_SIGNAL_GATE,
  QUANT_TOP10,
} from "@/lib/quant/v3-screen";

export const dynamic = "force-dynamic";

/**
 * 美股量化 P0：v3 筛选观察页。
 * 纯展示页：不调 API、不写数据库、不接券商、不下单、不构成买入建议。
 * 数据为 2026-11-03 冻结快照；12 月初按冻结规则复算后整体替换。
 */
export default function QuantScreenPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">美股量化 · v3 筛选观察名单</h1>
        <p className="mt-1 text-sm text-gray-600">
          与联盟营销同级的独立板块。只做筛选与判断，不下单、不承诺收益。
          数据日期 {QUANT_DATA_AS_OF}，股票池 {QUANT_POOL_SIZE} 只美股大盘股；
          综合分 ≥70 为进场线、跌破 50 为退出线。
        </p>
        <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-800">
          当前状态：观察，不进场。KO、JNJ、MRK 三只在 v3 规则变更当日跨过
          70 线，按冻结纪律“同一天改规则、同一天不触发进场”，须等 12
          月初同一规则复算仍 ≥70 且信号门通过，才谈进场。
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold">v3 前十（四维百分位等权）</h2>
        <p className="mt-1 text-xs text-gray-500">
          价值 = 个股 PE ÷ 行业 PE 中位数再算百分位；动量 = 12-1；质量 =
          ROE + 净利润增速（ROE 须净利润与净资产同一财年截止日，增速优先调整后口径）；
          行业上限 3 只。PE 缺失（V、XOM）留空，不编造。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">代码</th>
              <th className="py-2 pr-2">公司</th>
              <th className="py-2 pr-2">行业</th>
              <th className="py-2 pr-2">综合</th>
              <th className="py-2 pr-2">价值</th>
              <th className="py-2 pr-2">动量</th>
              <th className="py-2 pr-2">质量</th>
              <th className="py-2 pr-2">低波动</th>
              <th className="py-2 pr-2">相对 PE</th>
            </tr>
          </thead>
          <tbody>
            {QUANT_TOP10.map((r) => (
              <tr key={r.symbol} className="border-b">
                <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2">{r.sectorZh}</td>
                <td className="py-2 pr-2 font-semibold">{r.composite.toFixed(1)}</td>
                <td className="py-2 pr-2">{r.value.toFixed(1)}</td>
                <td className="py-2 pr-2">{r.momentum.toFixed(1)}</td>
                <td className="py-2 pr-2">{r.quality.toFixed(1)}</td>
                <td className="py-2 pr-2">{r.lowVol.toFixed(1)}</td>
                <td className="py-2 pr-2">{r.peRel.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">
          教训已锁进规则：JNJ 增速用调整后 +8.1%（GAAP
          +90.6% 含约 70 亿美元滑石粉准备金转回，不用）；V 的 ROE
          为陈旧数（2025 利润 ÷ 2011 净资产）已作废，质量门不通过；
          价格动量与低波在滚动回测中跑输基准，v3 里只作四维之一，不单独选股。
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold">信号门（只定能不能动手，不改名单）</h2>
        <p className="mt-1 text-xs text-gray-500">
          任一恶化信号成立则进场延期，不论分数。信号以实际结果为准，预测概率只作背景。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">信号</th>
              <th className="py-2 pr-2">时间</th>
              <th className="py-2 pr-2">状态</th>
              <th className="py-2">说明</th>
            </tr>
          </thead>
          <tbody>
            {QUANT_SIGNAL_GATE.map((s) => (
              <tr key={s.signal} className="border-b align-top">
                <td className="py-2 pr-2 font-semibold">{s.signal}</td>
                <td className="py-2 pr-2 whitespace-nowrap">{s.date}</td>
                <td className="py-2 pr-2">{s.status}</td>
                <td className="py-2">{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-base font-semibold">冻结规则（12 月初复算前不改）</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>池子 40 只不变；基本面只有新 10-K filed 才刷新，否则沿用旧值并标注财年日期。</li>
          <li>ROE 与增速缺失不估算；无调整后口径的票，增速记缺失，不用 GAAP 增速代替。</li>
          <li>复算交付：新前十 + 与 2026-11-03 的对比 + 信号门逐项结论，结论只写进场 / 观察 / 停用三档。</li>
          <li>本页不是买入建议；本站无券商账户、无交易授权，任何情况下不由本站下单。</li>
        </ul>
      </div>
    </div>
  );
}
