import {
  CN_QUANT_DATA_AS_OF,
  CN_QUANT_DATA_SOURCES,
  CN_QUANT_ENTRY_LINE,
  CN_QUANT_EXIT_LINE,
  CN_QUANT_FACTOR_EVIDENCE,
  CN_QUANT_NEWS_GATES,
  CN_QUANT_POOL,
  CN_QUANT_POOL_SIZE,
  CN_QUANT_SIGNALS,
} from "@/lib/quant/cn-v1-screen";

export const dynamic = "force-dynamic";

/**
 * 中国量化 P0：v1 选股框架页。
 * 纯展示页：不调 API、不写数据库、不接券商、不下单、不构成买入建议。
 * 分数待服务端首次真实拉取后才填；本页不编造任何个股分数、价格或新闻。
 * 冻结规则：2026-11-07，见 ~/workspace/cn-quant/cn-v1-preregistration.md。
 */
export default function CnQuantScreenPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">中国量化 · v1 选股框架</h1>
        <p className="mt-1 text-sm text-gray-600">
          与联盟营销、美股量化同级的独立板块。只做筛选与判断，不下单、不承诺收益。
          股票池 {CN_QUANT_POOL_SIZE} 只 A 股大中盘；六维百分位等权（价值 / 质量 /
          低波动 / 红利 / 现金流 / 反转）；综合分 ≥{CN_QUANT_ENTRY_LINE} 为进场线、
          跌破 {CN_QUANT_EXIT_LINE} 为退出线。
        </p>
        <p className="mt-2 rounded bg-red-50 p-3 text-sm font-semibold text-red-800">
          非投资建议。本页不是买入建议；历史回测不代表未来收益；数据来自第三方公开来源，
          可能存在延迟或错误。本站无券商账户、无交易授权，任何情况下不由本站下单。
        </p>
        <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-800">
          当前状态：观察，不进场。规则冻结于 {CN_QUANT_DATA_AS_OF}；
          个股因子分待服务端首次真实拉取（Baostock / Tushare / AKShare）
          并按冻结规则算出后才填，在此之前全部显示“待拉取”，不展示编造的分数。
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold">因子证据（中证指数，2011–2024 RankIC 均值）</h2>
        <p className="mt-1 text-xs text-gray-500">
          A 股不能照搬美股 12-1 动量：动量 RankIC 为 −0.011，整体无效，微盘显著反向；
          有效的是短期反转。低波、价值、质量、红利、现金流五维入选，成长整体弱，只作观察。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">因子</th>
              <th className="py-2 pr-2">定义</th>
              <th className="py-2 pr-2">RankIC</th>
              <th className="py-2 pr-2">胜率</th>
              <th className="py-2">说明</th>
            </tr>
          </thead>
          <tbody>
            {CN_QUANT_FACTOR_EVIDENCE.map((f) => (
              <tr key={f.factor} className="border-b align-top">
                <td className="py-2 pr-2 font-semibold">{f.factor}</td>
                <td className="py-2 pr-2">{f.definition}</td>
                <td className="py-2 pr-2">{f.rankIc}</td>
                <td className="py-2 pr-2">{f.winRate}</td>
                <td className="py-2">{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-base font-semibold">股票池（{CN_QUANT_POOL_SIZE} 只，分数待首次拉取）</h2>
        <p className="mt-1 text-xs text-gray-500">
          每因子先（5%,95%）缩尾 → Z-Score → 行业 / ln 流通市值中性化取残差；
          质量门：ROE 须净利润与净资产同一报告期，增速优先扣非口径，缺失不估算；
          至少 5/6 维可得才进前十排序，同一行业前十里最多 3 只；剔除 ST/*ST、退市整理、停牌股。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">代码</th>
              <th className="py-2 pr-2">名称</th>
              <th className="py-2 pr-2">行业</th>
              <th className="py-2 pr-2">价值</th>
              <th className="py-2 pr-2">质量</th>
              <th className="py-2 pr-2">低波动</th>
              <th className="py-2 pr-2">红利</th>
              <th className="py-2 pr-2">现金流</th>
              <th className="py-2 pr-2">反转</th>
              <th className="py-2">综合</th>
            </tr>
          </thead>
          <tbody>
            {CN_QUANT_POOL.map((r) => (
              <tr key={r.code} className="border-b">
                <td className="py-2 pr-2 font-semibold">{r.code}</td>
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2">{r.sectorZh}</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 pr-2 text-gray-400">待拉取</td>
                <td className="py-2 text-gray-400">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-base font-semibold">机构进场 / 出场信号（7 类，建议口径）</h2>
        <p className="mt-1 text-xs text-gray-500">
          须 2–3 个信号同向才加分，单信号不触发买卖，任一信号权重不超过总分的 25%。
          进场加分 = 北向季度持股↑ + 机构龙虎榜净买入↑ + 融资温和↑ + 调研密集；
          出场减分 = 北向连续 3 日净卖出 + 机构龙虎榜净卖出 + 融资连续 4 日下降 +
          大宗深折价 + 股东户数连续上升。北向自 2024-08-19 起无盘中实时披露，只能盘后/季度看。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">信号</th>
              <th className="py-2 pr-2">建议阈值思路</th>
              <th className="py-2 pr-2">滞后 / 坑</th>
              <th className="py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {CN_QUANT_SIGNALS.map((s) => (
              <tr key={s.signal} className="border-b align-top">
                <td className="py-2 pr-2 font-semibold">{s.signal}</td>
                <td className="py-2 pr-2">{s.threshold}</td>
                <td className="py-2 pr-2">{s.lag}</td>
                <td className="py-2">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-base font-semibold">财经新闻与政策信号门（只定能不能动手，不改名单）</h2>
        <p className="mt-1 text-xs text-gray-500">
          新闻信号须标注来源、发布时间、原文链接；标题党 / 自媒体不触发硬门；
          一级校验源为巨潮资讯公告原文。降准降息只作 regime 切换，不暂停。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">事件</th>
              <th className="py-2 pr-2">级别</th>
              <th className="py-2">处理</th>
            </tr>
          </thead>
          <tbody>
            {CN_QUANT_NEWS_GATES.map((g) => (
              <tr key={g.event} className="border-b align-top">
                <td className="py-2 pr-2 font-semibold">{g.event}</td>
                <td className="py-2 pr-2">{g.level}</td>
                <td className="py-2">{g.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-base font-semibold">A 股制度（回测与执行必须内置）</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>T+1：信号 T 日产生 → T+1 开盘执行 → T+2 最早卖出；禁止宣传日内回转 / T+0。</li>
          <li>涨跌停不可成交：主板 ±10%，创业板 / 科创板 ±20%，北交所 ±30%；主板 ST/*ST 自 2026-07-06 由 5% 放宽至 10%。</li>
          <li>100 股整数倍；成本至少 0.1–0.3%/次；前复权价格；财报按公告日对齐，防前视偏差。</li>
          <li>退市新规：主板财务退市“利润总额 / 净利润 / 扣非净利润为负 + 营收 &lt;3 亿元”；市值退市主板 &lt;5 亿元。</li>
          <li>程序化交易先报告、后交易（2024-10-08 实施）；高频认定：单账户每秒申报撤单 ≥300 笔或全日 ≥20,000 笔（2025-07-07 实施细则）。</li>
          <li>默认只做多头选股；融券受限，多空收益仅作研究展示并标注不可交易。</li>
        </ul>
      </div>

      <div>
        <h2 className="text-base font-semibold">数据自动抓取分工（P1 落地，当前未接通）</h2>
        <p className="mt-1 text-xs text-gray-500">
          主辅源因子值不一致 &gt;5% 时标黄，不直接用于评分。Token 用环境变量，绝不进仓库。
          东财 / 新浪 / 腾讯公开 HTTP 接口为非官方接口，条款禁止未经许可的复制 / 传播行情，
          不得再分发 / 商用，不得公开托管拉取的原始行情。
        </p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2">数据源</th>
              <th className="py-2 pr-2">用途</th>
              <th className="py-2 pr-2">凭证</th>
              <th className="py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {CN_QUANT_DATA_SOURCES.map((d) => (
              <tr key={d.source} className="border-b align-top">
                <td className="py-2 pr-2 font-semibold">{d.source}</td>
                <td className="py-2 pr-2">{d.use}</td>
                <td className="py-2 pr-2">{d.token}</td>
                <td className="py-2">{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">
          P1 待办：服务端定时任务（Baostock 免费先行，不需用户提供凭证）拉行情与财报，
          Tushare token 由用户在服务器环境变量里配置后补财务口径，AKShare 作资金流 / 龙虎榜辅源并做健康监控；
          拉到数后按冻结规则重算本页分数并标注数据日期。
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold">冻结规则（首次真实拉取前不改）</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>池子 30 只不变；基本面只有新财报披露才刷新，否则沿用旧值并标注报告期。</li>
          <li>ROE 与增速缺失不估算；无扣非口径的票，增速记缺失，不用 GAAP 增速代替。</li>
          <li>复算交付：新前十 + 与冻结版的对比 + 信号门逐项结论，结论只写进场 / 观察 / 停用三档。</li>
          <li>本页不是买入建议；本站无券商账户、无交易授权，任何情况下不由本站下单。</li>
        </ul>
      </div>
    </div>
  );
}
