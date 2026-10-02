import React from 'react';
import { InputNumber, Switch, Slider, Select, Tooltip, Checkbox } from 'antd';
import { TOL_FIELDS } from './schema.js';

export function TolEditor({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="tol">
      {TOL_FIELDS.map(([k, label, min, max, step]) => (
        <label key={k}><span>{label}</span><InputNumber size="small" min={min} max={max} step={step} value={value[k]} placeholder="default" onChange={(v) => set(k, v ?? undefined)} /></label>
      ))}
      {value.bonus && Object.keys(value.bonus).map((k) => (
        <label key={'b' + k}><span>bonus {k}</span><InputNumber size="small" min={0} max={3} step={0.05} value={value.bonus[k]} onChange={(v) => set('bonus', { ...value.bonus, [k]: v ?? 0 })} /></label>
      ))}
    </div>
  );
}

export function Field({ it, opts, setOpt }) {
  if (it.when && !opts[it.when]) return null;
  const v = opts[it.key], on = (x) => setOpt(it.key, x);
  let ctl;
  if (it.type === 'bool') ctl = <Switch size="small" checked={!!v} onChange={on} />;
  else if (it.type === 'int' || it.type === 'num') ctl = <InputNumber size="small" min={it.min} max={it.max} step={it.step} value={v} onChange={(x) => x !== null && on(x)} style={{ width: 110 }} />;
  else if (it.type === 'select') ctl = <Select size="small" value={v} onChange={on} style={{ width: 210 }} options={it.options.map(([value, label]) => ({ value, label }))} />;
  else if (it.type === 'multi') ctl = <Checkbox.Group value={v} onChange={(x) => on([...x].sort((a, b) => a - b))} options={it.options.map((o) => ({ label: String(o), value: o }))} />;
  else if (it.type === 'range') ctl = <Slider range min={it.min} max={it.max} step={it.step} value={v} onChange={on} style={{ width: 160 }} />;
  else if (it.type === 'tol') return <div className="field tolfield">{it.label && <div className="flabel">{it.label}</div>}<TolEditor value={v} onChange={on} /></div>;
  return (
    <div className={'field' + (it.when ? ' sub' : '')}>
      <Tooltip title={it.help}><span className="flabel">{it.label}</span></Tooltip>
      {ctl}
    </div>
  );
}

