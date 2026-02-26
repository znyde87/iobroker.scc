import React from 'react';
import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetProps, VisRxWidgetState } from '@iobroker/types-vis-2';

interface FlowData {
  surplus?: { powerW?: number };
  generation?: { totalW?: number };
  grid?: { consumptionW?: number; feedInW?: number };
  consumption?: { totalW?: number; wallboxW?: number; heatPumpW?: number };
  batteries?: {
    totalChargeW?: number;
    totalDischargeW?: number;
    items?: Record<string, { soc?: number }>;
  };
  widgetOptions?: { useHeatPumpImage?: boolean; wallboxEnabled?: boolean };
}

const PATH_PV = 'M 499 798 L 498 758 L 452 702 L 553 678 L 652 657 L 743 635';
const PATH_PV_FLOW = 'M 743 635 L 652 657 L 553 678 L 452 702 L 498 758 L 499 798';
const PATH_HAUS = 'M 463 815 L 425 825 L 380 812 L 379 838';
/* Netz: bis Gerät (848,766), Lücke am Gerät, dann ab 850,847; Ende 918,950 leicht durchsichtig */
const PATH_NETZ_TO_DEVICE = 'M 547 801 L 848 729 L 848 766';
const PATH_NETZ_FROM_DEVICE = 'M 850 847 L 859 918';
const PATH_NETZ_END = 'M 859 918 L 918 950';
const PATH_BATTERIE = 'M 546 845 L 657 815 L 657 869';
const PATH_WALLBOX = 'M 196 858 L 196 908';
const PATH_HEATPUMP = 'M 764 750 L 764 840'; /* vertikal: von 764,750 runter auf 764,840; eingespeist wie Last (Netz/PV/Mix) */

function fmtW(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '–';
  const w = Number(val);
  return w >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W';
}

function parseFlowData(val: unknown): FlowData | null {
  if (val == null) return null;
  const raw = (typeof val === 'object' && val !== null && 'val' in val) ? (val as { val: unknown }).val : val;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as FlowData;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && raw !== null && 'surplus' in raw) return raw as FlowData;
  return null;
}

const VisRxWidgetBase = (window as unknown as { visRxWidget: new (p: VisRxWidgetProps) => React.Component<VisRxWidgetProps, VisRxWidgetState> }).visRxWidget;

export default class SccHouseFlowWidget extends VisRxWidgetBase {
  static adapter = 'scc';

  constructor(props: VisRxWidgetProps) {
    super(props);
  }

  static getWidgetInfo(): RxWidgetInfo {
    return {
      id: 'sccHouseFlow',
      visSet: 'scc',
      visSetIcon: '',
      visSetLabel: 'scc_House_Flow',
      visSetColor: '#4caf50',
      visName: 'SccHouseFlowWidget',
      visAttrs: [
        {
          name: 'private',
          label: 'private',
          fields: [
            {
              name: 'oid',
              type: 'id',
              label: 'scc_flowData_oid',
            },
          ],
        },
      ],
      visPrev: '',
    };
  }

  getWidgetInfo(): RxWidgetInfo {
    return SccHouseFlowWidget.getWidgetInfo();
  }

  static getI18nPrefix(): string {
    return 'scc_';
  }

  renderWidgetBody(_props: RxRenderWidgetProps): React.ReactElement {
    const s = (this as unknown as { state: { rxData?: { oid?: string }; values?: Record<string, unknown> } }).state;
    const oid = s.rxData?.oid;
    let val: unknown;
    if (oid && s.values) {
      val = s.values[`${oid}.val`] ?? s.values[oid];
    } else {
      val = undefined;
    }
    const data = parseFlowData(val);
    return <SccHouseFlowDiagram data={data} />;
  }
}

function SccHouseFlowDiagram({ data }: { data: FlowData | null }): React.ReactElement {
  const genW = (data?.generation?.totalW != null) ? Number(data.generation.totalW) : 0;
  const gridConsW = (data?.grid?.consumptionW != null) ? Number(data.grid.consumptionW) : 0;
  const gridFeedW = (data?.grid?.feedInW != null) ? Number(data.grid.feedInW) : 0;
  const consumptionW = (data?.consumption?.totalW != null) ? Number(data.consumption.totalW) : 0;
  const wallboxW = Math.max(0, Number(data?.consumption?.wallboxW ?? 0)) || 0;
  const heatPumpW = Math.max(0, Number(data?.consumption?.heatPumpW ?? 0)) || 0;
  const totalChargeW = (data?.batteries?.totalChargeW != null) ? Number(data.batteries.totalChargeW) : 0;
  const totalDischargeW = (data?.batteries?.totalDischargeW != null) ? Number(data.batteries.totalDischargeW) : 0;
  const batItems = data?.batteries?.items ?? {};
  const firstSoc = Object.values(batItems)[0]?.soc ?? null;
  const socStr = firstSoc != null ? Math.round(firstSoc) + '%' : '–';
  const batStatus = totalChargeW > 0 ? 'lädt' : totalDischargeW > 0 ? 'entlädt' : 'wartet';
  const useHeatPumpImage = !!(data?.widgetOptions?.useHeatPumpImage) || (data?.consumption && data.consumption.heatPumpW != null);
  const wallboxEnabled = !!(data?.widgetOptions?.wallboxEnabled) || (data?.consumption && data.consumption.wallboxW != null);
  const gridActive = gridConsW > 0 || gridFeedW > 0;
  console.log('[SCC Flow Widget]', { wallboxW, heatPumpW, wallboxEnabled, useHeatPumpImage, consumption: data?.consumption, widgetOptions: data?.widgetOptions });

  function dirClass(k: string): string {
    if (k === 'battery') return (totalDischargeW > 0 && totalChargeW <= 0) ? 'scc-house-line--dir-rev' : 'scc-house-line--dir-fwd';
    if (k === 'grid') return (gridFeedW > 0) ? 'scc-house-line--dir-fwd' : 'scc-house-line--dir-rev';
    if (k === 'wallbox' || k === 'heatpump') return 'scc-house-line--dir-fwd';
    return 'scc-house-line--dir-fwd';
  }
  function flowColorClass(t: string): string {
    if (t === 'pv' || t === 'battery') return 'scc-house-line--green';
    if (t === 'grid') return (gridFeedW > 0) ? 'scc-house-line--green' : 'scc-house-line--red';
    if (t === 'house') {
      if (gridConsW > 0 && genW > 0) return 'scc-house-line--mixed';
      if (gridConsW > 0) return 'scc-house-line--red';
      return 'scc-house-line--green';
    }
    if (t === 'wallbox' || t === 'heatpump') {
      if (gridConsW > 0 && genW > 0) return 'scc-house-line--mixed';
      if (gridConsW > 0) return 'scc-house-line--red';
      return 'scc-house-line--green';
    }
    return 'scc-house-line--green';
  }
  function lineCls(active: boolean, t: string): string {
    let c = `scc-house-line scc-house-line--${t} ${dirClass(t)} ${flowColorClass(t)}`;
    if (active) c += ' scc-house-line--active';
    return c;
  }
  function baseCls(t: string): string {
    return `scc-house-line-base scc-house-line-base--${t}`;
  }
  function valueColorClass(t: string): string {
    if (t === 'pv') return (genW > 0) ? 'scc-house-value--green' : 'scc-house-value--muted';
    if (t === 'house') {
      if (consumptionW <= 0) return 'scc-house-value--muted';
      if (gridConsW > 0 && genW > 0) return 'scc-house-value--mixed';
      if (gridConsW > 0) return 'scc-house-value--red';
      return 'scc-house-value--green';
    }
    if (t === 'battery') {
      if (totalChargeW > 0) return 'scc-house-value--green';
      if (totalDischargeW > 0) return 'scc-house-value--red';
      return 'scc-house-value--muted';
    }
    if (t === 'grid') {
      if (gridFeedW > 0) return 'scc-house-value--green';
      if (gridConsW > 0) return 'scc-house-value--red';
      return 'scc-house-value--muted';
    }
    return 'scc-house-value--muted';
  }

  const socPercent = firstSoc != null ? Math.min(100, Math.max(0, Number(firstSoc))) : 0;
  const isCharging = totalChargeW > 0;
  const isDischarging = totalDischargeW > 0;
  const segFill = isCharging ? '#00c853' : (isDischarging ? '#c62828' : 'rgba(255,255,255,0.25)');
  const segEmpty = 'rgba(255,255,255,0.08)';
  const segs = [0, 1, 2, 3, 4].map((i) => {
    const threshold = (i + 1) * 20;
    const filled = socPercent >= threshold;
    const lastFilledIdx = Math.max(-1, Math.min(4, Math.floor(socPercent / 20) - 1));
    const charging = (isCharging || isDischarging) && i === lastFilledIdx;
    return { i, filled, charging };
  });

  const id = 'scc-house-flow-' + Math.random().toString(36).slice(2, 9);

  return (
    <div className="scc-house-widget" style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <style>{`
        .scc-house-widget { --scc-bg: #1a1a1e; --scc-text: #e0e0e0; --scc-muted: #9e9e9e; --scc-heading: #fff; }
        .scc-house-widget .scc-house-wrap { position: relative; width: 100%; max-width: 100%; margin: 0; aspect-ratio: 1024/1536; background: var(--scc-bg); border-radius: 12px; overflow: hidden; }
        .scc-house-widget .scc-house-svg { position: absolute; left:0; top:0; width:100%; height:100%; pointer-events: none; }
        .scc-house-widget .scc-house-lines .scc-house-line-base { stroke: rgba(0,0,0,0.85); stroke-width: 5; stroke-linecap: round; }
        .scc-house-widget .scc-house-lines .scc-house-line { stroke-width: 6; stroke-linecap: round; stroke: rgba(0,0,0,0); }
        .scc-house-widget .scc-house-lines .scc-house-line--active { stroke-width: 7; filter: url(#${id}-glow); }
        .scc-house-widget .scc-house-lines .scc-house-line--active.scc-house-line--green { stroke: url(#${id}-green); }
        .scc-house-widget .scc-house-lines .scc-house-line--active.scc-house-line--red { stroke: url(#${id}-red); }
        .scc-house-widget .scc-house-lines .scc-house-line--active.scc-house-line--mixed { stroke: url(#${id}-mixed); }
        .scc-house-widget .scc-house-lines .scc-house-line--active { stroke-dasharray: 6 22; animation: scc-dash .9s linear infinite; }
        .scc-house-widget .scc-house-lines .scc-house-line--active.scc-house-line--dir-rev { animation-direction: reverse; }
        @keyframes scc-dash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -28; } }
        .scc-house-widget .scc-house-connectors .scc-house-conn { fill: none; stroke: rgba(255,255,255,0.35); stroke-width: 1.8; stroke-dasharray: 6 10; }
        .scc-house-widget .scc-house-battery-display .scc-battery-seg { transition: fill .35s ease; }
        .scc-house-widget .scc-house-battery-display .scc-battery-seg--charging { animation: scc-pulse 1.2s ease-in-out infinite; }
        @keyframes scc-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
        .scc-house-widget .scc-house-value { font-size: 42px; font-weight: 700; fill: var(--scc-heading); paint-order: stroke; stroke: rgba(0,0,0,.8); stroke-width: 5px; }
        .scc-house-widget .scc-house-label { font-size: 20px; fill: var(--scc-muted); text-transform: uppercase; paint-order: stroke; stroke: rgba(0,0,0,.65); stroke-width: 3px; }
        .scc-house-widget .scc-house-sublabel { font-size: 18px; fill: var(--scc-muted); text-transform: uppercase; paint-order: stroke; stroke: rgba(0,0,0,.55); stroke-width: 2.5px; }
        .scc-house-widget .scc-house-value--green { fill: #5aff78 !important; }
        .scc-house-widget .scc-house-value--red { fill: #ff6b6b !important; }
        .scc-house-widget .scc-house-value--mixed { fill: #81c784; }
        .scc-house-widget .scc-house-value--muted { fill: var(--scc-muted) !important; }
        .scc-house-widget .scc-house-line-base--grid-end { stroke-opacity: 0.45; }
        .scc-house-widget .scc-house-line--grid-end.scc-house-line--active { stroke-opacity: 0.65; }
        .scc-house-widget .scc-house-line--dashed { stroke-dasharray: 6 10; }
        .scc-house-widget .scc-house-line--dashed.scc-house-line--active { stroke-dasharray: 6 22; }
        .scc-house-widget .scc-house-line--dashed.scc-house-line--active.scc-house-line--green { stroke: url(#${id}-green) !important; }
        .scc-house-widget .scc-house-line--dashed.scc-house-line--active.scc-house-line--red { stroke: url(#${id}-red) !important; }
        .scc-house-widget .scc-house-line--dashed.scc-house-line--active.scc-house-line--mixed { stroke: url(#${id}-mixed) !important; }
        .scc-house-widget .scc-house-line--active.scc-house-line--wallbox.scc-house-line--green,
        .scc-house-widget .scc-house-line--active.scc-house-line--heatpump.scc-house-line--green { stroke: #00c853 !important; }
        .scc-house-widget .scc-house-line--active.scc-house-line--wallbox.scc-house-line--red,
        .scc-house-widget .scc-house-line--active.scc-house-line--heatpump.scc-house-line--red { stroke: #e53935 !important; }
        .scc-house-widget .scc-house-line--active.scc-house-line--wallbox.scc-house-line--mixed,
        .scc-house-widget .scc-house-line--active.scc-house-line--heatpump.scc-house-line--mixed { stroke: #5aff78 !important; }
      `}</style>
      <div className="scc-house-wrap">
        <svg className="scc-house-svg" viewBox="0 0 1024 1536" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" preserveAspectRatio="xMidYMid meet">
          <image href={useHeatPumpImage ? '/adapter/scc/house_heatpump2.png' : '/adapter/scc/house.png'} x={0} y={0} width={1024} height={1536} preserveAspectRatio="xMidYMid meet" style={{ opacity: 1 }} />
          {/* Fallback: dezenter Haus-Umriss (sichtbar wenn house.png fehlt) */}
          <g className="scc-house-fallback" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5">
            <path d="M 350 750 L 512 550 L 674 750 Z" />
            <path d="M 380 750 L 380 950 L 644 950 L 644 750" />
          </g>
          <defs>
            <linearGradient id={`${id}-green`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00c853" /><stop offset="35%" stopColor="#69f0ae" /><stop offset="65%" stopColor="#69f0ae" /><stop offset="100%" stopColor="#00c853" />
            </linearGradient>
            <linearGradient id={`${id}-red`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#b71c1c" /><stop offset="35%" stopColor="#ff6b6b" /><stop offset="65%" stopColor="#ff6b6b" /><stop offset="100%" stopColor="#b71c1c" />
            </linearGradient>
            <linearGradient id={`${id}-mixed`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#5aff78" /><stop offset="50%" stopColor="#5aff78" /><stop offset="50%" stopColor="#ff6b6b" /><stop offset="100%" stopColor="#ff6b6b" />
            </linearGradient>
            <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g className="scc-house-connectors">
            <path d="M 521 200 L 521 574" className="scc-house-conn" />
            <path d="M 379 140 L 379 838" className="scc-house-conn" />
            <path d="M 669 1330 L 669 942" className="scc-house-conn" />
            <path d="M 918 1330 L 918 950" className="scc-house-conn" />
          </g>
          <g className="scc-house-lines">
            <path d={PATH_PV} className={baseCls('pv')} fill="none" />
            <path d={PATH_HAUS} className={baseCls('house')} fill="none" />
            <path d={PATH_NETZ_TO_DEVICE} className={baseCls('grid')} fill="none" />
            <path d={PATH_NETZ_FROM_DEVICE} className={baseCls('grid')} fill="none" />
            <path d={PATH_NETZ_END} className={`${baseCls('grid')} scc-house-line-base--grid-end`} fill="none" />
            <path d={PATH_BATTERIE} className={baseCls('battery')} fill="none" />
            {wallboxEnabled && <path d={PATH_WALLBOX} className={baseCls('wallbox')} fill="none" />}
            {useHeatPumpImage && <path d={PATH_HEATPUMP} className={baseCls('heatpump')} fill="none" />}
            <path d={PATH_PV_FLOW} className={lineCls(genW > 0, 'pv')} fill="none" pathLength={100} />
            <path d={PATH_HAUS} className={lineCls(consumptionW > 0, 'house')} fill="none" pathLength={100} />
            <path d={PATH_NETZ_TO_DEVICE} className={lineCls(gridActive, 'grid')} fill="none" pathLength={100} />
            <path d={PATH_NETZ_FROM_DEVICE} className={lineCls(gridActive, 'grid')} fill="none" pathLength={100} />
            <path d={PATH_NETZ_END} className={`${lineCls(gridActive, 'grid')} scc-house-line--grid-end`} fill="none" pathLength={100} />
            <path d={PATH_BATTERIE} className={lineCls(totalChargeW > 0 || totalDischargeW > 0, 'battery')} fill="none" pathLength={100} />
            {wallboxEnabled && <path d={PATH_WALLBOX} className={`${lineCls(wallboxW > 0, 'wallbox')} scc-house-line--dashed`} fill="none" pathLength={100} />}
            {useHeatPumpImage && <path d={PATH_HEATPUMP} className={`${lineCls(heatPumpW > 0, 'heatpump')} scc-house-line--dashed`} fill="none" pathLength={100} />}
          </g>
          <g className="scc-house-battery-display" transform="matrix(1.1875,-0.3542,0,0.9872,640.25,912.55)">
            {[74, 58, 42, 26, 10].map((y, i) => {
              const { filled, charging } = segs[i];
              return (
                <rect key={i} className={`scc-battery-seg ${charging ? 'scc-battery-seg--charging' : ''}`} x={4} y={y} width={48} height={14} rx={5} ry={5} fill={filled ? segFill : segEmpty} />
              );
            })}
          </g>
          <g className="scc-house-labels">
            <g className="scc-house-label-block scc-house-label-top" transform="translate(521, 200)">
              <text data-scc="val-pv" className={`scc-house-value ${valueColorClass('pv')}`} y={0} textAnchor="middle">{fmtW(genW)}</text>
              <text className="scc-house-label" y={50} textAnchor="middle">Photovoltaik</text>
            </g>
            <g className="scc-house-label-block scc-house-label-top" transform="translate(379, 140)">
              <text data-scc="val-house" className={`scc-house-value ${valueColorClass('house')}`} y={0} textAnchor="middle">{fmtW(consumptionW)}</text>
              <text className="scc-house-label" y={50} textAnchor="middle">Last</text>
            </g>
            <g className="scc-house-label-block scc-house-label-bottom" transform="translate(669, 1330)">
              <text data-scc="val-battery" className={`scc-house-value ${valueColorClass('battery')}`} y={0} textAnchor="middle">{fmtW(totalChargeW > 0 ? totalChargeW : totalDischargeW)}</text>
              <text data-scc="lab-battery" className={`scc-house-label ${valueColorClass('battery')}`} y={50} textAnchor="middle">Batterie {socStr} {batStatus}</text>
            </g>
            <g className="scc-house-label-block scc-house-label-bottom" transform="translate(918, 1330)">
              <text data-scc="val-grid" className={`scc-house-value ${valueColorClass('grid')}`} y={0} textAnchor="middle">{gridConsW > 0 ? fmtW(gridConsW) : gridFeedW > 0 ? fmtW(gridFeedW) : '–'}</text>
              <text data-scc="sub-grid" className={`scc-house-sublabel ${valueColorClass('grid')}`} y={48} textAnchor="middle">{gridConsW > 0 ? 'Bezug' : gridFeedW > 0 ? 'Einspeisung' : ''}</text>
              <text className="scc-house-label" y={72} textAnchor="middle">Netz</text>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
