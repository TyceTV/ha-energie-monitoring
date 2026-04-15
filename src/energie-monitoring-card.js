class EnergieMonitoringCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._cfg = {};
    this._hass = null;
    this._d = {};
    this._busy = false;
    this._auto = {
      refYearCache: {}
    };
  }

  _obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  _num(v, fallback, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    let out = n;
    if (Number.isFinite(min)) out = Math.max(min, out);
    if (Number.isFinite(max)) out = Math.min(max, out);
    return out;
  }

  _numOrNull(v, min, max) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    let out = n;
    if (Number.isFinite(min)) out = Math.max(min, out);
    if (Number.isFinite(max)) out = Math.min(max, out);
    return out;
  }

  _str(v, fallback = '') {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s.length ? s : fallback;
  }

  _bool(v, fallback) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
    }
    return fallback;
  }

  _enum(v, allowed, fallback) {
    const s = this._str(v, '').toLowerCase();
    return allowed.includes(s) ? s : fallback;
  }

  _txt(key, fallback) {
    const txt = this._cfg?.ui?.texts?.[key];
    return typeof txt === 'string' && txt.trim() ? txt : fallback;
  }

  _t(key, de, en) {
    const txt = this._cfg?.ui?.texts?.[key];
    if (typeof txt === 'string' && txt.trim()) return txt;
    const locale = String(this._cfg?.locale || this._cfg?.ui?.locale || 'de-DE').toLowerCase();
    return locale.startsWith('en') ? (en ?? de) : de;
  }

  _isLeapYear(y) {
    const n = parseInt(y, 10);
    if (!Number.isFinite(n)) return false;
    return (n % 4 === 0 && n % 100 !== 0) || (n % 400 === 0);
  }

  _deriveBkwSeit(startDate, locale) {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) return this._t('unknown', 'unbekannt', 'unknown');
    return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  _normalizeConfig(rawCfg) {
    const raw = this._obj(rawCfg);
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
    const hasFinite = (...vals) => vals.some((v) => Number.isFinite(Number(v)));
    const nowYear = new Date().getFullYear();
    const hasReportYear = hasOwn(raw, 'report_year') || hasOwn(raw, 'berichtsjahr');
    const hasReferenceYear = hasOwn(raw, 'reference_year') || hasOwn(raw, 'referenzjahr');
    const reportYear = this._str(raw.report_year ?? raw.berichtsjahr, String(nowYear));
    const referenceYear = this._str(raw.reference_year ?? raw.referenzjahr, String(nowYear - 1));

    const ui = this._obj(raw.ui);
    const uiTexts = this._obj(ui.texts ?? raw.texts);
    const entities = this._obj(raw.entities);
    const targets = this._obj(raw.targets);
    const reference = this._obj(raw.reference);
    const thresholds = this._obj(raw.thresholds);
    const tariff = this._obj(raw.tariff);
    const billing = this._obj(raw.billing);
    const bkw = this._obj(raw.bkw);
    const amortization = this._obj(raw.amortization);
    const showSections = this._obj(ui.show_sections);

    const locale = this._str(ui.locale ?? raw.locale, 'de-DE');
    const currency = this._str(ui.currency ?? raw.currency, 'EUR');
    const title = this._str(ui.title ?? raw.title, 'Strom-Monitoring - Soll/Ist Bewertung');
    const hasCustomSubtitle = hasOwn(ui, 'subtitle') || hasOwn(raw, 'subtitle');
    const autoSubtitle = (hasReportYear || hasReferenceYear)
      ? (String(locale).toLowerCase().startsWith('en')
        ? ('Reference year ' + referenceYear + ' � Report year ' + reportYear)
        : ('Referenzjahr ' + referenceYear + ' � Berichtsjahr ' + reportYear))
      : '';
    const subtitle = this._str(ui.subtitle ?? raw.subtitle, autoSubtitle);

    const entityGrid = this._str(
      raw.entity_grid_total_kwh ?? entities.grid_total_kwh ?? raw.entity,
      ''
    );
    const entitySolarToday = this._str(
      raw.entity_solar_today_kwh ?? entities.solar_today_kwh ?? raw.entity_solar_today,
      ''
    );
    const entitySolarTotal = this._str(
      raw.entity_solar_total_kwh ?? entities.solar_total_kwh ?? raw.entity_solar_total,
      ''
    );
    const entitySolarExport = this._str(
      raw.entity_solar_export_kwh ?? entities.solar_export_kwh ?? raw.entity_solar_export,
      ''
    );

    const hasTargetsConfig = hasFinite(
      targets.day_kwh, targets.month_kwh, targets.year_kwh,
      raw.tagesziel, raw.monatsziel, raw.jahresziel
    );
    const hasReferenceConfig = hasFinite(
      reference.day_kwh, reference.month_kwh, reference.year_kwh,
      raw.ref_tag, raw.ref_mon, raw.ref_jahr
    );

    const yearDaysMode = this._enum(raw.year_days_mode, ['auto', '365', '366'], 'auto');
    const yearDaysCount = yearDaysMode === '365'
      ? 365
      : yearDaysMode === '366'
        ? 366
        : (this._isLeapYear(reportYear) ? 366 : 365);

    const targetYearRaw = hasTargetsConfig ? this._numOrNull(targets.year_kwh ?? raw.jahresziel, 0, 10000000) : null;
    const targetDayRaw = hasTargetsConfig ? this._numOrNull(targets.day_kwh ?? raw.tagesziel, 0, 1000000) : null;
    const targetMonthRaw = hasTargetsConfig ? this._numOrNull(targets.month_kwh ?? raw.monatsziel, 0, 1000000) : null;
    const targetYear = Number.isFinite(targetYearRaw) ? targetYearRaw : null;
    const targetDay = Number.isFinite(targetDayRaw)
      ? targetDayRaw
      : (Number.isFinite(targetYear) ? +(targetYear / yearDaysCount).toFixed(2) : null);
    const targetMonth = Number.isFinite(targetMonthRaw)
      ? targetMonthRaw
      : (Number.isFinite(targetYear) ? +(targetYear / 12).toFixed(1) : null);

    const refYearRaw = hasReferenceConfig ? this._numOrNull(reference.year_kwh ?? raw.ref_jahr, 0, 10000000) : null;
    const refDayRaw = hasReferenceConfig ? this._numOrNull(reference.day_kwh ?? raw.ref_tag, 0, 1000000) : null;
    const refMonthRaw = hasReferenceConfig ? this._numOrNull(reference.month_kwh ?? raw.ref_mon, 0, 1000000) : null;
    const refYear = Number.isFinite(refYearRaw) ? refYearRaw : null;
    const refDay = Number.isFinite(refDayRaw)
      ? refDayRaw
      : (Number.isFinite(refYear) ? +(refYear / yearDaysCount).toFixed(2) : null);
    const refMonth = Number.isFinite(refMonthRaw)
      ? refMonthRaw
      : (Number.isFinite(refYear) ? +(refYear / 12).toFixed(1) : null);

    let goodThreshold = this._num(thresholds.good_pct, -5, -1000, 1000);
    let warnThreshold = this._num(thresholds.warn_pct, 5, -1000, 1000);
    const thresholdMode = this._enum(thresholds.mode, ['symmetric', 'custom'], 'symmetric');
    if (thresholdMode === 'symmetric') {
      const m = Math.abs(warnThreshold || 5);
      goodThreshold = -m;
      warnThreshold = m;
    }
    if (goodThreshold > warnThreshold) {
      const tmp = goodThreshold;
      goodThreshold = warnThreshold;
      warnThreshold = tmp;
    }

    const energyCtNet = this._num(
      tariff.energy_ct_per_kwh_net ?? raw.arbeitspreis_ct,
      27.965,
      0,
      100000
    );
    const baseYearNet = this._num(
      tariff.base_eur_per_year_net ?? raw.grundpreis_jahr,
      75.6,
      0,
      1000000
    );
    const meteringYearNet = this._num(
      tariff.metering_eur_per_year_net ?? raw.messst_jahr,
      18.92,
      0,
      1000000
    );
    const vatPct = this._num(tariff.vat_pct, 19, 0, 100);
    const referenceCostBrutto = this._num(
      billing.reference_cost_brutto_eur ?? raw.kosten_2025_brutto,
      1465.25,
      0,
      100000000
    );
    const monthlyAdvanceBrutto = this._num(
      billing.monthly_advance_brutto_eur ?? raw.abschlag_brutto,
      135,
      0,
      1000000
    );

    const bkwStartDate = this._str(bkw.start_date ?? raw.bkw_start_datum, reportYear + '-01-01');
    const bkwEnabled = this._bool(
      bkw.enabled,
      !!(entitySolarToday || entitySolarTotal || entitySolarExport)
    );
    const bkwInvestment = this._num(
      bkw.investment_eur ?? raw.bkw_kosten,
      1099.99,
      0,
      100000000
    );
    const bkwNominalKwp = this._num(
      bkw.nominal_kwp ?? raw.bkw_kwp,
      1.72,
      0,
      10000
    );
    const bkwBatteryKwh = this._num(
      bkw.battery_kwh ?? raw.bkw_speicher,
      2.048,
      0,
      10000
    );
    const bkwFeedInLimitW = this._num(bkw.feed_in_limit_w, 800, 0, 1000000);
    const bkwSeit = this._str(raw.bkw_seit, this._deriveBkwSeit(bkwStartDate, locale));

    const amortizationMode = this._enum(
      amortization.value_mode,
      ['gross_tariff', 'net_tariff', 'custom'],
      'gross_tariff'
    );
    const defaultStrompreis = energyCtNet / 100 * (1 + vatPct / 100);
    const customEurPerKwh = this._num(
      amortization.custom_eur_per_kwh ?? raw.strompreis,
      defaultStrompreis,
      0,
      100000
    );
    const strompreis = amortizationMode === 'net_tariff'
      ? +(energyCtNet / 100).toFixed(6)
      : amortizationMode === 'custom'
        ? customEurPerKwh
        : +defaultStrompreis.toFixed(6);

    const updateIntervalSec = this._num(
      ui.update_interval_sec ?? raw.update_interval_sec,
      120,
      30,
      86400
    );

    const yearStartKwh = this._numOrNull(raw.year_start_meter_kwh ?? raw.jahres_start_kwh, 0, 100000000);
    const einzugKwh = this._numOrNull(raw.einzug_kwh, 0, 100000000);
    const einzugDatum = this._str(raw.einzug_datum, '01.01.' + reportYear);
    const hasYearStartKwh = hasOwn(raw, 'year_start_meter_kwh') || hasOwn(raw, 'jahres_start_kwh');
    const hasEinzugDatum = hasOwn(raw, 'einzug_datum');

    const hasExplicitBkwSection = hasOwn(showSections, 'bkw');
    const hasExplicitCostsSection = hasOwn(showSections, 'costs');
    const hasExplicitAmortizationSection = hasOwn(showSections, 'amortization');
    const hasSolarEntities = !!(entitySolarToday || entitySolarTotal || entitySolarExport);
    const hasTariffConfig = hasFinite(
      tariff.energy_ct_per_kwh_net, tariff.base_eur_per_year_net, tariff.metering_eur_per_year_net, tariff.vat_pct,
      raw.arbeitspreis_ct, raw.grundpreis_jahr, raw.messst_jahr
    );
    const hasBillingConfig = hasFinite(
      billing.reference_cost_brutto_eur, billing.monthly_advance_brutto_eur,
      raw.kosten_2025_brutto, raw.abschlag_brutto
    );
    const hasCostConfig = hasTariffConfig && hasBillingConfig;
    const autoShowBkw = bkwEnabled && hasSolarEntities;
    const autoShowCosts = hasCostConfig;
    const autoShowAmortization = autoShowBkw && (hasOwn(raw, 'amortization') || hasOwn(raw, 'bkw'));

    return {
      ui: {
        title,
        subtitle,
        locale,
        currency,
        texts: uiTexts,
        show_warnings: this._bool(ui.show_warnings ?? raw.show_warnings, true),
        update_interval_sec: updateIntervalSec,
        show_sections: {
          table: this._bool(showSections.table, true),
          bkw: hasExplicitBkwSection ? this._bool(showSections.bkw, true) : autoShowBkw,
          costs: hasExplicitCostsSection ? this._bool(showSections.costs, true) : autoShowCosts,
          amortization: hasExplicitAmortizationSection ? this._bool(showSections.amortization, true) : autoShowAmortization
        }
      },
      meta: {
        has_report_year: hasReportYear,
        has_reference_year: hasReferenceYear,
        has_year_start_kwh: hasYearStartKwh,
        has_einzug_datum: hasEinzugDatum,
        has_custom_subtitle: hasCustomSubtitle,
        has_targets_config: hasTargetsConfig,
        has_reference_config: hasReferenceConfig,
        has_tariff_config: hasTariffConfig,
        has_billing_config: hasBillingConfig
      },
      entities: {
        grid_total_kwh: entityGrid,
        solar_today_kwh: entitySolarToday,
        solar_total_kwh: entitySolarTotal,
        solar_export_kwh: entitySolarExport
      },
      targets: { day_kwh: targetDay, month_kwh: targetMonth, year_kwh: targetYear },
      reference: { day_kwh: refDay, month_kwh: refMonth, year_kwh: refYear },
      thresholds: { mode: thresholdMode, good_pct: goodThreshold, warn_pct: warnThreshold },
      tariff: {
        energy_ct_per_kwh_net: energyCtNet,
        base_eur_per_year_net: baseYearNet,
        metering_eur_per_year_net: meteringYearNet,
        vat_pct: vatPct
      },
      billing: {
        reference_cost_brutto_eur: referenceCostBrutto,
        monthly_advance_brutto_eur: monthlyAdvanceBrutto
      },
      bkw: {
        enabled: bkwEnabled,
        start_date: bkwStartDate,
        investment_eur: bkwInvestment,
        nominal_kwp: bkwNominalKwp,
        battery_kwh: bkwBatteryKwh,
        feed_in_limit_w: bkwFeedInLimitW
      },
      amortization: {
        value_mode: amortizationMode,
        custom_eur_per_kwh: customEurPerKwh
      },
      report_year: reportYear,
      reference_year: referenceYear,
      year_days_mode: yearDaysMode,
      year_days_count: yearDaysCount,

      // Legacy flat keys (Abwaertskompatibilitaet + bestehendes Rendering)
      title,
      subtitle,
      entity: entityGrid,
      entity_solar_today: entitySolarToday,
      entity_solar_total: entitySolarTotal,
      entity_solar_export: entitySolarExport,
      tagesziel: targetDay,
      monatsziel: targetMonth,
      jahresziel: targetYear,
      ref_tag: refDay,
      ref_mon: refMonth,
      ref_jahr: refYear,
      referenzjahr: referenceYear,
      berichtsjahr: reportYear,
      jahres_start_kwh: yearStartKwh,
      einzug_kwh: einzugKwh,
      einzug_datum: einzugDatum,
      bkw_seit: bkwSeit,
      bkw_start_datum: bkwStartDate,
      bkw_kwp: bkwNominalKwp,
      bkw_speicher: bkwBatteryKwh,
      bkw_kosten: bkwInvestment,
      strompreis,
      arbeitspreis_ct: energyCtNet,
      grundpreis_jahr: baseYearNet,
      messst_jahr: meteringYearNet,
      kosten_2025_brutto: referenceCostBrutto,
      abschlag_brutto: monthlyAdvanceBrutto,
      update_interval_sec: updateIntervalSec,
      tariff_vat_pct: vatPct,
      good_threshold_pct: goodThreshold,
      warn_threshold_pct: warnThreshold,
      locale,
      currency
    };
  }

  setConfig(c) {
    this._cfg = this._normalizeConfig(c);
    if (!this._cfg.entity) {
      throw new Error(
        'Pflichtfeld fehlt: entity_grid_total_kwh (oder legacy: entity) muss gesetzt werden.'
      );
    }
  }

  set hass(h) {
    this._hass = h;
    if (!this._busy) this._run();
  }

  _stateNumber(entityId) {
    if (!entityId) return null;
    const raw = this._hass?.states?.[entityId]?.state;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }

  async _getVal(start) {
    const e = this._cfg.entity;
    if (!e) return null;
    try {
      const data = await this._hass.callApi('GET',
        'history/period/' + start.toISOString() +
        '?filter_entity_id=' + e +
        '&end_time=' + new Date().toISOString() +
        '&minimal_response=true&no_attributes=true&significant_changes_only=false');
      const rows = (data[0] || []).filter(s =>
        s.state !== 'unavailable' && s.state !== 'unknown' &&
        s.state !== 'None' && s.state !== '0');
      if (!rows.length) return null;
      const first = parseFloat(rows[0].state);
      const cur = parseFloat(this._hass.states[e]?.state);
      if (isNaN(first) || isNaN(cur) || cur < first) return null;
      return cur - first;
    } catch (err) { return null; }
  }

  async _getConsumptionBetween(start, end) {
    const e = this._cfg.entity;
    if (!e || !(start instanceof Date) || !(end instanceof Date)) return null;
    try {
      const data = await this._hass.callApi('GET',
        'history/period/' + start.toISOString() +
        '?filter_entity_id=' + e +
        '&end_time=' + end.toISOString() +
        '&minimal_response=true&no_attributes=true&significant_changes_only=false');
      const rows = (data[0] || []).filter((s) => {
        if (!s || s.state === 'unavailable' || s.state === 'unknown' || s.state === 'None') return false;
        return Number.isFinite(parseFloat(s.state));
      });
      if (!rows.length) return null;
      const first = parseFloat(rows[0].state);
      const last = parseFloat(rows[rows.length - 1].state);
      if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
      return +(last - first).toFixed(3);
    } catch (_err) {
      return null;
    }
  }

  async _getAutoReferenceYearConsumption(referenceYear) {
    const y = parseInt(referenceYear, 10);
    if (!Number.isFinite(y)) return null;
    const cache = this._auto.refYearCache[y];
    const nowMs = Date.now();
    if (cache && (nowMs - cache.ts) < 6 * 60 * 60 * 1000) {
      return cache.val;
    }
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    const val = await this._getConsumptionBetween(start, end);
    this._auto.refYearCache[y] = { ts: nowMs, val };
    return val;
  }

  async _run() {
    if (!this._hass) return;
    this._busy = true;
    try {
      const now = new Date();
      const sDay = new Date(now); sDay.setHours(0, 0, 0, 0);
      const dow = now.getDay();
      const sWeek = new Date(now);
      sWeek.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
      sWeek.setHours(0, 0, 0, 0);
      const sMon = new Date(now.getFullYear(), now.getMonth(), 1);

      const [day, week, month] = await Promise.all([
        this._getVal(sDay), this._getVal(sWeek), this._getVal(sMon)
      ]);

      // Jahresverbrauch direkt aus Zaehler - Jahresstartwert
      const cur = this._stateNumber(this._cfg.entity);
      const year = (cur !== null && this._cfg.jahres_start_kwh != null)
        ? Math.max(0, cur - this._cfg.jahres_start_kwh) : null;

      // Solar direkt aus Sensoren lesen
      const eTot = this._cfg.entity_solar_total;
      const eDay = this._cfg.entity_solar_today;
      const eExp = this._cfg.entity_solar_export;
      const solarTotal = this._stateNumber(eTot);
      const solarToday = this._stateNumber(eDay);
      // Eingespeist = Ueberschuss
      const solarExport = this._stateNumber(eExp);
      // Selbstverbrauch = PV gesamt - eingespeist
      const solarSelf = (solarTotal !== null && solarExport !== null)
        ? Math.max(0, solarTotal - solarExport) : null;

      let refYearAuto = null;
      if (!this._cfg.meta?.has_reference_config && this._cfg.meta?.has_reference_year) {
        refYearAuto = await this._getAutoReferenceYearConsumption(this._cfg.reference_year);
      }

      this._d = { day, week, month, year, solarTotal, solarToday, solarExport, solarSelf, refYearAuto };
    } catch (e) { this._d = {}; }
    this._busy = false;
    this._paint();
    setTimeout(() => this._run(), this._cfg.update_interval_sec * 1000);
  }

  _deriveAutoBenchmarks(cfg, d, ctx) {
    let tDay = Number.isFinite(cfg.tagesziel) ? cfg.tagesziel : null;
    let tMonth = Number.isFinite(cfg.monatsziel) ? cfg.monatsziel : null;
    let tYear = Number.isFinite(cfg.jahresziel) ? cfg.jahresziel : null;
    let targetsSource = 'manual';

    if (!cfg.meta?.has_targets_config) {
      if (Number.isFinite(d.year) && ctx.doy > 0) {
        tYear = +(d.year / ctx.doy * ctx.yearDays).toFixed(1);
        tMonth = +(tYear / 12).toFixed(1);
        tDay = +(tYear / ctx.yearDays).toFixed(2);
        targetsSource = 'auto_from_year_progress';
      } else {
        tYear = tMonth = tDay = null;
        targetsSource = 'none';
      }
    }

    let rDay = Number.isFinite(cfg.ref_tag) ? cfg.ref_tag : null;
    let rMonth = Number.isFinite(cfg.ref_mon) ? cfg.ref_mon : null;
    let rYear = Number.isFinite(cfg.ref_jahr) ? cfg.ref_jahr : null;
    let referenceSource = 'manual';

    if (!cfg.meta?.has_reference_config) {
      if (Number.isFinite(d.refYearAuto)) {
        rYear = +d.refYearAuto.toFixed(1);
        rMonth = +(rYear / 12).toFixed(1);
        rDay = +(rYear / ctx.yearDays).toFixed(2);
        referenceSource = 'auto_from_reference_year';
      } else if (Number.isFinite(tYear)) {
        rYear = tYear;
        rMonth = tMonth;
        rDay = tDay;
        referenceSource = 'auto_from_targets_fallback';
      } else {
        rYear = rMonth = rDay = null;
        referenceSource = 'none';
      }
    }

    return {
      tagesziel: tDay,
      monatsziel: tMonth,
      jahresziel: tYear,
      ref_tag: rDay,
      ref_mon: rMonth,
      ref_jahr: rYear,
      targetsSource,
      referenceSource,
      hasTargets: Number.isFinite(tYear),
      hasReference: Number.isFinite(rYear)
    };
  }

  // ── Hilfsfunktionen ──────────────────────────────────────────────────────────
  _badge(a) {
    const good = Number.isFinite(this._cfg.good_threshold_pct) ? this._cfg.good_threshold_pct : -5;
    const warn = Number.isFinite(this._cfg.warn_threshold_pct) ? this._cfg.warn_threshold_pct : 5;
    if (a === null || a === undefined) return { cls: 'bg', dot: 'dg', lbl: this._t('badge_no_data', 'Keine Daten', 'No data') };
    if (a <= good) return { cls: 'be', dot: 'de', lbl: this._t('badge_saving', 'Einsparung', 'Saving') };
    if (a > warn)   return { cls: 'br', dot: 'dr', lbl: this._t('badge_overuse', 'Mehrverbrauch', 'Overuse') };
    return { cls: 'bo', dot: 'do', lbl: this._t('badge_in_target', 'Im Soll', 'In target') };
  }

  _abw(i, z) {
    if (i === null || i === undefined || isNaN(i) || !z) return null;
    return (i - z) / z * 100;
  }

  _fmt(v, d) {
    if (v === null || v === undefined || isNaN(v)) return '\u2013';
    return v.toFixed(d === undefined ? 1 : d).replace('.', ',') + ' kWh';
  }

  _pct(v) {
    if (v === null || v === undefined || isNaN(v)) return '\u2013';
    return (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' %';
  }

  _eur(v) {
    if (v === null || v === undefined || isNaN(v)) return '\u2013';
    try {
      return new Intl.NumberFormat(this._cfg.locale || 'de-DE', {
        style: 'currency',
        currency: this._cfg.currency || 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(v);
    } catch (_err) {
      return v.toFixed(2).replace('.', ',') + ' \u20ac';
    }
  }

  _kw(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil((((t - y) / 86400000) + 1) / 7);
  }

  _calcTimeContext(now, cfg) {
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dom = now.getDate();
    const h = now.getHours() + now.getMinutes() / 60;
    const dow = now.getDay();
    const dw = dow === 0 ? 7 : dow;
    const yearDays = cfg.year_days_count || 365;
    return { doy, dim, dom, h, dw, yearDays };
  }

  _calcTargets(cfg, ctx) {
    if (!Number.isFinite(cfg.tagesziel) || !Number.isFinite(cfg.monatsziel) || !Number.isFinite(cfg.jahresziel)) {
      return { dayTarget: null, weekTarget: null, monthTarget: null, yearTarget: null };
    }
    return {
      dayTarget: +(cfg.tagesziel * Math.max(ctx.h, 0.1) / 24).toFixed(2),
      weekTarget: +(cfg.tagesziel * ctx.dw).toFixed(1),
      monthTarget: +(cfg.monatsziel * ctx.dom / ctx.dim).toFixed(1),
      yearTarget: +(cfg.jahresziel * ctx.doy / ctx.yearDays).toFixed(1)
    };
  }

  _calcBkwMetrics(cfg, d, now, yearDays) {
    const bkwStart = new Date(cfg.bkw_start_datum);
    const startMs = bkwStart.getTime();
    const validStart = Number.isFinite(startMs);
    const daysSinceBkw = validStart
      ? Math.max(1, Math.floor((now - bkwStart) / 86400000))
      : null;

    const solarGesamt = Number.isFinite(d.solarTotal) ? d.solarTotal : null;
    const solarExport = Number.isFinite(d.solarExport) ? d.solarExport : null;
    const solarSelf = Number.isFinite(d.solarSelf) ? d.solarSelf : null;
    const solarToday = Number.isFinite(d.solarToday) ? d.solarToday : null;
    const svQuote = (solarGesamt !== null && solarGesamt > 0 && solarSelf !== null)
      ? +(solarSelf / solarGesamt * 100).toFixed(1) : null;
    const gespartEur = solarSelf !== null ? +(solarSelf * cfg.strompreis).toFixed(2) : null;
    const restBetrag = gespartEur !== null ? +(cfg.bkw_kosten - gespartEur).toFixed(2) : null;
    const eurProTag = (gespartEur !== null && daysSinceBkw > 0)
      ? +(gespartEur / daysSinceBkw).toFixed(4) : null;
    const kwhSelfProTag = (solarSelf !== null && daysSinceBkw > 0)
      ? +(solarSelf / daysSinceBkw).toFixed(2) : null;
    const kwhTotalProTag = (solarGesamt !== null && daysSinceBkw > 0)
      ? +(solarGesamt / daysSinceBkw).toFixed(2) : null;
    const restTage = (eurProTag && eurProTag > 0 && restBetrag > 0)
      ? Math.ceil(restBetrag / eurProTag) : null;
    const amortDatum = restTage ? new Date(now.getTime() + restTage * 86400000) : null;
    const amortStr = amortDatum
      ? amortDatum.toLocaleDateString(cfg.locale || 'de-DE', { month: 'long', year: 'numeric' })
      : '\u2013';
    const amortJahre = (eurProTag && eurProTag > 0)
      ? +(cfg.bkw_kosten / eurProTag / yearDays).toFixed(1) : null;
    const pct = gespartEur !== null && cfg.bkw_kosten > 0
      ? Math.min(100, +(gespartEur / cfg.bkw_kosten * 100).toFixed(1))
      : 0;
    const barCol = pct >= 100 ? '#4ade80' : pct > 50 ? '#60a5fa' : '#fbbf24';
    const solarHeuteEur = solarToday !== null ? +(solarToday * cfg.strompreis).toFixed(2) : null;

    return {
      bkwStart,
      validStart,
      daysSinceBkw,
      solarGesamt,
      solarExport,
      solarSelf,
      solarToday,
      svQuote,
      gespartEur,
      restBetrag,
      eurProTag,
      kwhSelfProTag,
      kwhTotalProTag,
      restTage,
      amortStr,
      amortJahre,
      pct,
      barCol,
      solarHeuteEur
    };
  }

  _calcProgress(d, ctx) {
    const progWoche = (d.week !== null && ctx.dw > 0)
      ? (d.week / ctx.dw * 7).toFixed(0) + ' kWh ' + this._t('unit_week', '(Woche)', '(Week)') : null;
    const progMon = (d.month !== null && ctx.dom > 0)
      ? (d.month / ctx.dom * ctx.dim).toFixed(0) + ' kWh ' + this._t('unit_month', '(Monat)', '(Month)') : null;
    const progJahr = (d.year !== null && ctx.doy > 0)
      ? (d.year / ctx.doy * ctx.yearDays).toFixed(0) + ' kWh ' + this._t('unit_year_projection', '(Hochrechnung Jahr)', '(Projected year)') : null;
    return { progWoche, progMon, progJahr };
  }

  _calcConsumption(cfg, d, now, ctx, targets, cur, prog) {
    const locale = cfg.locale || 'de-DE';
    const hasTargets = !!cfg.meta?.has_targets_config;
    const hasRef = !!cfg.meta?.has_reference_config;
    const fmtNum = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '�';
    const fmtKwh = (v, d = 1) => Number.isFinite(v) ? fmtNum(v, d) + ' kWh' : '�';
    const rows = [
      {
        z: this._t('period_today', 'Heute', 'Today'),
        zs: now.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
        b: this._t('consumption_day_label', 'Tagesverbrauch (Netz)', 'Daily consumption (grid)'),
        bs: hasTargets
          ? this._t('day_target_prefix', 'Tagesziel: ', 'Daily target: ') + fmtKwh(cfg.tagesziel, 1) + ' � ' + this._t('prorated_prefix', 'anteilig: ', 'prorated: ') + fmtKwh(targets.dayTarget, 1) + ' (' + Math.round(ctx.h) + 'h)'
          : '�',
        r: hasRef && Number.isFinite(cfg.ref_tag) ? fmtNum(cfg.ref_tag, 1) + ' kWh/Tag' : '�',
        rs: '�' + (cfg.meta?.has_reference_year ? ' ' + cfg.referenzjahr : ''),
        i: d.day,
        prog: null,
        z2: targets.dayTarget,
        a: this._abw(d.day, targets.dayTarget)
      },
      {
        z: this._t('period_week', 'Diese Woche', 'This week'),
        zs: 'Mo�' + now.toLocaleDateString(locale, { weekday: 'short' }) + ' � KW ' + this._kw(now) + ' � ' + ctx.dw + ' von 7 Tagen',
        b: this._t('consumption_week_label', 'Wochenverbrauch (Netz)', 'Weekly consumption (grid)'),
        bs: hasTargets
          ? this._t('prorated_prefix', 'anteilig: ', 'prorated: ') + fmtKwh(targets.weekTarget, 1) + ' � ' + this._t('full_week_prefix', 'Vollwoche: ', 'Full week: ') + fmtKwh(cfg.tagesziel * 7, 1)
          : '�',
        r: hasRef && Number.isFinite(cfg.ref_tag) ? fmtKwh(cfg.ref_tag * 7, 1) : '�',
        rs: this._t('projection_prefix', 'Hochrechnung', 'Projection') + (cfg.meta?.has_reference_year ? ' ' + cfg.referenzjahr : ''),
        i: d.week,
        prog: prog.progWoche,
        z2: targets.weekTarget,
        a: this._abw(d.week, targets.weekTarget)
      },
      {
        z: now.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
        zs: hasTargets
          ? 'Tag ' + ctx.dom + ' von ' + ctx.dim + ' � ' + this._t('prorated_prefix', 'anteilig: ', 'prorated: ') + fmtKwh(targets.monthTarget, 1)
          : 'Tag ' + ctx.dom + ' von ' + ctx.dim,
        b: this._t('consumption_month_label', 'Monatsverbrauch (Netz)', 'Monthly consumption (grid)'),
        bs: hasTargets ? this._t('full_month_prefix', 'Vollmonatsziel: ', 'Full month target: ') + fmtKwh(cfg.monatsziel, 0) : '�',
        r: hasRef && Number.isFinite(cfg.ref_mon) ? fmtKwh(cfg.ref_mon, 0) : '�',
        rs: this._t('reference_short', 'Referenz', 'Reference') + (cfg.meta?.has_reference_year ? ' ' + cfg.referenzjahr : '') + ' (�/Monat)',
        i: d.month,
        prog: prog.progMon,
        z2: targets.monthTarget,
        a: this._abw(d.month, targets.monthTarget)
      },
      {
        z: now.getFullYear().toString(),
        zs: hasTargets
          ? 'Tag ' + ctx.doy + ' von ' + ctx.yearDays + ' � ' + this._t('prorated_prefix', 'anteilig: ', 'prorated: ') + fmtKwh(targets.yearTarget, 0)
          : 'Tag ' + ctx.doy + ' von ' + ctx.yearDays,
        b: this._t('consumption_year_label', 'Jahresverbrauch (Netz)', 'Yearly consumption (grid)'),
        bs: cfg.meta?.has_year_start_kwh
          ? this._t('meter_start_prefix', 'Z�hler 01.01.', 'Meter 01 Jan ') + cfg.berichtsjahr + ': ' + (cfg.jahres_start_kwh !== null ? cfg.jahres_start_kwh.toLocaleString(locale) : '�') + ' kWh ? ' + this._t('current_prefix', 'aktuell: ', 'current: ') + (cur === null ? '�' : cur.toLocaleString(locale, { maximumFractionDigits: 1 })) + ' kWh'
          : '�',
        r: hasRef && Number.isFinite(cfg.ref_jahr) ? fmtKwh(cfg.ref_jahr, 0) : '�',
        rs: this._t('reference_short', 'Referenz', 'Reference') + (cfg.meta?.has_reference_year ? ' ' + cfg.referenzjahr : '') + ' (Gesamt)',
        i: d.year,
        prog: prog.progJahr,
        z2: targets.yearTarget,
        a: this._abw(d.year, targets.yearTarget)
      }
    ];

    let green = 0, red = 0, orange = 0, gray = 0;
    rows.forEach((r) => {
      const b = this._badge(r.a);
      if (b.cls === 'be') green++;
      else if (b.cls === 'br') red++;
      else if (b.cls === 'bo') orange++;
      else gray++;
    });

    return {
      rows,
      green,
      red,
      orange,
      gray,
      stand: now.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      curStr: cur === null ? '�' : cur.toLocaleString(locale, { maximumFractionDigits: 1 }) + ' kWh'
    };
  }

  _calcCosts(cfg, d, ctx, bkw) {
    const vatFactor = 1 + (cfg.tariff_vat_pct / 100);
    const year = Number.isFinite(d.year) ? d.year : null;
    const forecastKwh = year !== null
      ? (year / Math.max(1, Math.floor((new Date() - new Date(cfg.berichtsjahr + '-01-01')) / 86400000)) * ctx.yearDays)
      : null;
    const projectedNet = year !== null
      ? (year * (cfg.arbeitspreis_ct / 100)) + cfg.grundpreis_jahr + cfg.messst_jahr
      : null;
    const projectedGross = projectedNet !== null ? projectedNet * vatFactor : null;
    const diffToReference = projectedGross !== null ? projectedGross - cfg.kosten_2025_brutto : null;
    const bkwSavingsCurrent = bkw.solarSelf !== null
      ? -(bkw.solarSelf * (cfg.arbeitspreis_ct / 100) * vatFactor)
      : null;
    const bkwSavingsYear = (bkw.solarSelf !== null && bkw.daysSinceBkw > 0)
      ? (bkw.solarSelf / bkw.daysSinceBkw * ctx.yearDays * (cfg.arbeitspreis_ct / 100) * vatFactor)
      : null;

    return {
      forecastKwh,
      projectedGross,
      diffToReference,
      bkwSavingsCurrent,
      bkwSavingsYear
    };
  }

  _calcAmortization(_cfg, bkw) {
    const restDuration = (bkw.restTage && bkw.restTage > 0)
      ? 'noch ca. ' + Math.floor(bkw.restTage / 365) + ' J. ' + Math.round((bkw.restTage % 365) / 30) + ' Mon.'
      : bkw.restBetrag !== null && bkw.restBetrag <= 0
        ? 'Amortisiert!'
        : '\u2013';

    return {
      restDuration,
      amortStr: bkw.amortStr,
      amortJahre: bkw.amortJahre,
      pct: bkw.pct,
      barCol: bkw.barCol,
      gespartEur: bkw.gespartEur,
      restBetrag: bkw.restBetrag
    };
  }

  _calcPlausibilityWarnings(cfg, d, ctx, bkw, costs) {
    const warnings = [];
    const pushWarn = (txt) => {
      if (txt && !warnings.includes(txt)) warnings.push(txt);
    };

    if (cfg.meta?.has_year_start_kwh && cfg.jahres_start_kwh === null) {
      pushWarn(this._t('warn_missing_year_start', 'Jahres-Startwert fehlt: year_start_meter_kwh setzen, damit Jahresverbrauch und Prognosen korrekt sind.', 'Missing year start value: set year_start_meter_kwh so yearly consumption and projections are correct.'));
    }

    if (cfg.meta?.has_tariff_config && !cfg.meta?.has_billing_config) {
      pushWarn(this._t('warn_billing_missing', 'Tarifdaten gesetzt, aber billing.* fehlt. Fuer den Kostenblock bitte billing.reference_cost_brutto_eur und billing.monthly_advance_brutto_eur setzen.', 'Tariff data is set, but billing.* is missing. For the cost block, please set billing.reference_cost_brutto_eur and billing.monthly_advance_brutto_eur.'));
    }

    if (!cfg.meta?.has_tariff_config && cfg.meta?.has_billing_config) {
      pushWarn(this._t('warn_tariff_missing', 'Billing-Daten gesetzt, aber tariff.* fehlt. Fuer den Kostenblock bitte Tarifwerte erg�nzen.', 'Billing data is set, but tariff.* is missing. Please add tariff values for the cost block.'));
    }


    if (cfg.targets && cfg.targets.day_kwh > 0 && cfg.targets.year_kwh > 0) {
      const expectedYear = cfg.targets.day_kwh * ctx.yearDays;
      const ratio = expectedYear > 0 ? cfg.targets.year_kwh / expectedYear : 1;
      if (ratio < 0.7 || ratio > 1.3) {
      pushWarn(this._t('warn_targets_inconsistent', 'Zielwerte wirken inkonsistent: targets.day_kwh und targets.year_kwh liegen weit auseinander.', 'Targets look inconsistent: targets.day_kwh and targets.year_kwh differ significantly.'));
      }
    }

    if (cfg.bkw?.enabled && !cfg.entity_solar_total && !cfg.entity_solar_today && !cfg.entity_solar_export) {
      pushWarn(this._t('warn_bkw_without_sensors', 'BKW ist aktiviert, aber keine Solar-Sensoren sind konfiguriert.', 'Balcony PV is enabled, but no solar sensors are configured.'));
    }

    if (bkw.solarGesamt !== null && bkw.solarExport !== null && bkw.solarExport > bkw.solarGesamt) {
      pushWarn(this._t('warn_export_gt_total', 'Solar-Einspeisung ist gr��er als Solar-Gesamtproduktion. Sensorwerte pr�fen.', 'Solar export is higher than total solar production. Please verify sensor values.'));
    }

    if (d.year !== null && costs.projectedGross !== null && cfg.billing?.reference_cost_brutto_eur > 0) {
      const ratioCost = costs.projectedGross / cfg.billing.reference_cost_brutto_eur;
      if (ratioCost > 2.5) {
        pushWarn(this._t('warn_cost_projection_high', 'Kostenprognose ist deutlich h�her als Referenzjahr. Tarif- und Z�hlerwerte pr�fen.', 'Cost projection is significantly higher than the reference year. Please verify tariff and meter values.'));
      }
    }

    return warnings;
  }

  _renderTableSection(cfg, tr, green, red, orange, gray) {
    const refYearLabel = cfg.meta?.has_reference_year ? (' ' + cfg.referenzjahr) : '';
    const reportYearLabel = cfg.meta?.has_report_year ? (' ' + cfg.berichtsjahr) : '';
    return `
  <div class="ctr">
    <div class="ct"><span class="cv g">${green}</span><span class="cl">${this._t('kpi_saving', 'Einsparung', 'Saving')}</span></div>
    <div class="ct"><span class="cv r">${red}</span><span class="cl">${this._t('kpi_overuse', 'Mehrverbrauch', 'Overuse')}</span></div>
    <div class="ct"><span class="cv o">${orange}</span><span class="cl">${this._t('kpi_in_target', 'Im Soll', 'In target')}</span></div>
    <div class="ct"><span class="cv x">${gray}</span><span class="cl">${this._t('kpi_no_data', 'Keine Daten', 'No data')}</span></div>
  </div>
  <div class="tw">
    <table>
      <thead><tr>
        <th>${this._t('th_period', 'Zeitraum', 'Period')}</th><th>${this._t('th_area', 'Verbrauchsbereich', 'Consumption area')}</th>
        <th>${this._t('th_reference', 'Referenz', 'Reference')}${refYearLabel} (kWh)</th>
        <th>${this._t('th_actual', 'Ist', 'Actual')}${reportYearLabel} (kWh)</th>
        <th>${this._t('th_delta', 'Abweichung', 'Deviation')} %</th><th>${this._t('th_rating', 'Bewertung', 'Rating')}</th>
      </tr></thead>
      <tbody>${tr}</tbody>
    </table>
  </div>`;
  }

  _renderBkwSection(cfg, bkwHintHtml, bkwDaysText, d, solarHeuteEur, solarGesamt, kwhTotalProTag, solarSelf, solarExport, svQuote, kwhSelfProTag, eurProTag) {
    return `
  <div class="bkw-block">
    <div class="bkw-hdr">&#9728;&#65039; ${this._t('bkw_header_title', 'Balkonkraftwerk', 'Balcony PV')} ${cfg.bkw_kwp} kWp &nbsp;&middot;&nbsp; ${this._t('active_since', 'aktiv seit', 'active since')} ${cfg.bkw_seit} &nbsp;&middot;&nbsp; ${bkwDaysText}</div>
    ${bkwHintHtml}
    <div class="bkw-grid">
      <div class="bkw-item">
        <span class="bkw-lbl">${this._t('pv_today_label', 'PV erzeugt heute', 'PV generated today')}</span>
        <span class="bkw-val" style="color:#fbbf24">${d.solarToday !== null && !isNaN(d.solarToday) ? this._fmt(d.solarToday) : '\u2013'}</span>
        <span class="bkw-sub">${solarHeuteEur !== null ? '\u2248 ' + this._eur(solarHeuteEur) + ' ' + this._t('equivalent_value', 'Gegenwert', 'equivalent value') : '\u2013'}</span>
      </div>
      <div class="bkw-item">
        <span class="bkw-lbl">${this._t('pv_total_label', 'PV erzeugt gesamt (seit Betrieb)', 'PV generated total (since start)')}</span>
        <span class="bkw-val" style="color:#fbbf24">${solarGesamt !== null ? this._fmt(solarGesamt, 0) : '\u2013'}</span>
        <span class="bkw-sub">${kwhTotalProTag !== null ? '\u00d8 ' + kwhTotalProTag.toFixed(2).replace('.', ',') + ' kWh/Tag' : ''}</span>
      </div>
      <div class="bkw-item">
        <span class="bkw-lbl">${this._t('self_used_label', 'Davon selbst verbraucht', 'Self-consumed')}</span>
        <span class="bkw-val" style="color:#4ade80">${solarSelf !== null ? this._fmt(solarSelf, 0) : '\u2013'}</span>
        <span class="bkw-sub">${solarExport !== null ? this._fmt(solarExport, 0) + ' ' + this._t('exported_unused', 'eingespeist (nicht genutzt)', 'exported (not used)') : ''}</span>
        ${svQuote !== null ? `<span class="bkw-badge">&#10003; ${svQuote.toFixed(1).replace('.', ',')} % ${this._t('self_consumption_rate', 'Eigenverbrauchsquote', 'self-consumption rate')}</span>` : ''}
      </div>
      <div class="bkw-item">
        <span class="bkw-lbl">&Oslash; ${this._t('self_consumption_per_day', 'Selbstverbrauch pro Tag', 'self-consumption per day')}</span>
        <span class="bkw-val" style="color:#4ade80">${kwhSelfProTag !== null ? kwhSelfProTag.toFixed(2).replace('.', ',') + ' kWh' : '\u2013'}</span>
        <span class="bkw-sub">${eurProTag !== null ? '\u2248 ' + this._eur(eurProTag) + '/' + this._t('per_day', 'Tag', 'day') + ' &nbsp;&middot;&nbsp; ' + this._eur(eurProTag * 30) + '/' + this._t('per_month', 'Monat', 'month') : '\u2013'}</span>
      </div>
      <div class="bkw-item">
        <span class="bkw-lbl">${this._t('investment_costs', 'Anschaffungskosten', 'Investment costs')}</span>
        <span class="bkw-val" style="color:#f87171">${this._eur(cfg.bkw_kosten)}</span>
        <span class="bkw-sub">${cfg.bkw_kwp} kWp &nbsp;&middot;&nbsp; ${cfg.bkw_speicher} kWh ${this._t('battery_label', 'Speicher', 'battery')} &nbsp;&middot;&nbsp; 800 W</span>
      </div>
    </div>
  </div>`;
  }

  _renderCostsSection(cfg, costs) {
    return `
  <div class="kosten-block">
    <div class="kosten-hdr">&#128176; ${this._t('costs_header', 'Stromkosten-Hochrechnung', 'Electricity cost projection')} &nbsp;&middot;&nbsp; ${this._t('costs_basis_prefix', 'Basis: Abrechnung', 'Basis: billing')} ${cfg.referenzjahr}</div>
    <div class="kosten-grid">
      <div class="kosten-item">
        <span class="kosten-lbl">${this._t('cost_reference_label', 'Verbrauch', 'Consumption')} ${cfg.referenzjahr} (${this._t('reference_short', 'Referenz', 'Reference')})</span>
        <span class="kosten-val">${cfg.ref_jahr.toLocaleString(cfg.locale || 'de-DE')} kWh</span>
        <span class="kosten-sub">${this._t('work_price_prefix', 'Arbeitspreis: ', 'Energy price: ')}${cfg.arbeitspreis_ct} ct/kWh &nbsp;&middot;&nbsp; ${this._t('base_price_prefix', 'Grundpreis: ', 'Base fee: ')}${this._eur(cfg.grundpreis_jahr)}/${this._t('per_year', 'Jahr', 'year')}</span>
      </div>
      <div class="kosten-item">
        <span class="kosten-lbl">${this._t('cost_label', 'Kosten', 'Cost')} ${cfg.referenzjahr} (${this._t('gross_incl_vat_prefix', 'Brutto inkl.', 'Gross incl.')} ${cfg.tariff_vat_pct}% ${this._t('vat_short', 'MwSt', 'VAT')})</span>
        <span class="kosten-val" style="color:#f87171">${this._eur(cfg.kosten_2025_brutto)}</span>
        <span class="kosten-sub">${this._t('advance_prefix', 'Abschlag', 'Monthly advance')} ${cfg.referenzjahr}/${cfg.berichtsjahr}: ${this._eur(cfg.abschlag_brutto)}/${this._t('per_month', 'Monat', 'month')}</span>
      </div>
      <div class="kosten-item">
        <span class="kosten-lbl">${this._t('projection_prefix', 'Hochrechnung', 'Projection')} ${cfg.berichtsjahr} (${this._t('grid_consumption', 'Netzverbrauch', 'Grid consumption')})</span>
        <span class="kosten-val" style="color:#fbbf24">${costs.projectedGross !== null ? this._eur(costs.projectedGross) : '\u2013'}</span>
        <span class="kosten-sub">${costs.projectedGross === null
          ? this._t('loading_data', 'Daten werden geladen...', 'Loading data...')
          : costs.forecastKwh.toFixed(0) + ' kWh ' + this._t('projection_short', 'Prognose', 'projection') + ' &nbsp;&middot;&nbsp; ' + (costs.diffToReference >= 0 ? '+' : '') + this._eur(costs.diffToReference) + ' vs. ' + cfg.referenzjahr
        }</span>
      </div>
      <div class="kosten-item">
        <span class="kosten-lbl">${this._t('bkw_savings_label', 'BKW-Ersparnis', 'Balcony PV savings')} ${cfg.berichtsjahr} (${this._t('self_consumption', 'Selbstverbrauch', 'Self-consumption')})</span>
        <span class="kosten-val" style="color:#4ade80">${costs.bkwSavingsCurrent !== null ? this._eur(costs.bkwSavingsCurrent) : '\u2013'}</span>
        <span class="kosten-sub">${costs.bkwSavingsYear !== null ? this._t('projection_prefix', 'Hochrechnung', 'Projection') + ': \u2248 ' + this._eur(costs.bkwSavingsYear) + ' ' + this._t('savings_per_year', 'Ersparnis/Jahr', 'savings/year') : ''}</span>
      </div>
    </div>
  </div>`;
  }

  _renderAmortizationSection(cfg, daysSinceBkw, gespartEur, restBetrag, amortization, amortStr, amortJahre, barCol, pct, bkwStartShort) {
    return `
  <div class="amor-block">
    <div class="amor-hdr">&#128185; ${this._t('amort_header', 'Amortisation', 'Amortization')} &nbsp;&middot;&nbsp; ${this._t('amort_basis_prefix', 'Basis: Selbstverbrauch (PV - Einspeisung) �', 'Basis: self-consumption (PV - export) �')} ${cfg.strompreis.toFixed(2).replace('.', ',')} &euro;/kWh</div>
    <div class="amor-grid">
      <div class="amor-stat">
        <span class="amor-lbl">${this._t('amort_already', 'Bereits amortisiert', 'Already amortized')}</span>
        <span class="amor-val" style="color:#4ade80">${this._eur(gespartEur)}</span>
        <span class="amor-sub">${daysSinceBkw !== null ? this._t('in_days_since_purchase', 'in ', 'in ') + daysSinceBkw + ' ' + this._t('days_since_purchase_suffix', 'Tagen seit Kauf', 'days since purchase') : this._t('amort_days_unknown', 'Betriebsdauer nicht berechenbar (Startdatum pr�fen)', 'Runtime cannot be calculated (check start date)')}</span>
      </div>
      <div class="amor-stat">
        <span class="amor-lbl">${this._t('amort_remaining', 'Noch ausstehend', 'Remaining')}</span>
        <span class="amor-val" style="color:#fbbf24">${restBetrag !== null ? this._eur(Math.max(0, restBetrag)) : '\u2013'}</span>
        <span class="amor-sub">${amortization.restDuration}</span>
      </div>
      <div class="amor-stat">
        <span class="amor-lbl">${this._t('amort_estimated_done', 'Voraussichtlich fertig', 'Estimated completion')}</span>
        <span class="amor-val" style="color:#60a5fa; font-size:16px">${amortStr}</span>
        <span class="amor-sub">${amortJahre ? amortJahre.toFixed(1).replace('.', ',') + ' ' + this._t('years_total_runtime', 'Jahre Gesamtlaufzeit', 'years total runtime') : '\u2013'}</span>
      </div>
      <div class="amor-stat">
        <span class="amor-lbl">${this._t('progress_label', 'Fortschritt', 'Progress')}</span>
        <span class="amor-val" style="color:${barCol}">${pct.toFixed(1).replace('.', ',')} %</span>
        <span class="amor-sub">${this._eur(gespartEur)} ${this._t('of_word', 'von', 'of')} ${this._eur(cfg.bkw_kosten)}</span>
      </div>
    </div>
    <div class="bar-wrap">
      <div class="bar-fill" style="width:${pct}%; background:${barCol}">
        ${pct >= 8 ? pct.toFixed(1).replace('.', ',') + ' %' : ''}
      </div>
    </div>
    <div class="bar-labels">
      <span>0 &euro; &ndash; ${bkwStartShort}</span>
      <span>${this._eur(gespartEur)} ${this._t('of_word', 'von', 'of')} ${this._eur(cfg.bkw_kosten)} ${this._t('saved_word', 'gespart', 'saved')}</span>
      <span>${this._eur(cfg.bkw_kosten)} &ndash; ${amortStr}</span>
    </div>
  </div>`;
  }

  // ── Hauptrendering ───────────────────────────────────────────────────────────
  _paint() {
    const cfg = this._cfg, d = this._d, now = new Date();
    const ctx = this._calcTimeContext(now, cfg);
    const auto = this._deriveAutoBenchmarks(cfg, d, ctx);
    const cfgRuntime = {
      ...cfg,
      tagesziel: auto.tagesziel,
      monatsziel: auto.monatsziel,
      jahresziel: auto.jahresziel,
      ref_tag: auto.ref_tag,
      ref_mon: auto.ref_mon,
      ref_jahr: auto.ref_jahr,
      meta: {
        ...cfg.meta,
        has_targets_config: auto.hasTargets,
        has_reference_config: auto.hasReference
      }
    };
    const targets = this._calcTargets(cfgRuntime, ctx);
    const bkw = this._calcBkwMetrics(cfg, d, now, ctx.yearDays);
    const prog = this._calcProgress(d, ctx);
    const cur = this._stateNumber(cfg.entity);

    // ── Amortisation: Selbstverbrauch (PV - Einspeisung) x Strompreis ──────────
    const bkwStart = bkw.bkwStart;
    const daysSinceBkw = bkw.daysSinceBkw;
    const solarGesamt = bkw.solarGesamt;
    const solarExport = bkw.solarExport;
    const solarSelf = bkw.solarSelf;
    const svQuote = bkw.svQuote;
    const eurProTag = bkw.eurProTag;
    const kwhSelfProTag = bkw.kwhSelfProTag;
    const kwhTotalProTag = bkw.kwhTotalProTag;
    const restTage = bkw.restTage;
    const solarHeuteEur = bkw.solarHeuteEur;
    const consumption = this._calcConsumption(cfgRuntime, d, now, ctx, targets, cur, prog);
    const costs = this._calcCosts(cfgRuntime, d, ctx, bkw);
    const amortization = this._calcAmortization(cfgRuntime, bkw);
    const warnings = this._calcPlausibilityWarnings(cfgRuntime, d, ctx, bkw, costs);
    if (auto.referenceSource === 'auto_from_targets_fallback') {
      warnings.push(this._t('warn_auto_reference_fallback', 'Auto-Referenz aktiv: Es wurden keine Referenzdaten gefunden, daher werden die Zielwerte als Referenz verwendet.', 'Auto reference active: No reference data found, using targets as reference.'));
    }
    if (auto.targetsSource === 'auto_from_year_progress') {
      warnings.push(this._t('warn_auto_targets_active', 'Auto-Ziele aktiv: Zielwerte wurden aus Jahresverlauf und year_start_meter_kwh abgeleitet.', 'Auto targets active: Targets are derived from year progress and year_start_meter_kwh.'));
    }
    const gespartEur = amortization.gespartEur;
    const restBetrag = amortization.restBetrag;
    const amortStr = amortization.amortStr;
    const amortJahre = amortization.amortJahre;
    const pct = amortization.pct;
    const barCol = amortization.barCol;

    // ── Tabellendaten (Netzverbrauch Soll/Ist) ──────────────────────────────────
    const rows = consumption.rows;

    const green = consumption.green;
    const red = consumption.red;
    const orange = consumption.orange;
    const gray = consumption.gray;

    const stand = consumption.stand;
    const curStr = consumption.curStr;

    const tr = rows.map(r => {
      const b = this._badge(r.a);
      const pc = this._pct(r.a);
      const pcol = r.a === null ? '' : (r.a > cfg.warn_threshold_pct ? 'color:#f87171' : r.a <= cfg.good_threshold_pct ? 'color:#4ade80' : 'color:#fbbf24');
      const iv = this._fmt(r.i);
      const vc = r.i === null ? '' : (r.i > r.z2 * 1.05 ? 'vr' : (r.i < r.z2 * 0.95 ? 'vg' : ''));
      const ph = r.prog ? `<span class="prog">\u21b3 ${r.prog}</span>` : '';
      return `<tr>
        <td><span class="cm">${r.z}</span><span class="cs">${r.zs}</span></td>
        <td><span class="cm">${r.b}</span><span class="cs">${r.bs}</span></td>
        <td><span class="cm">${r.r}</span><span class="cs">${r.rs}</span></td>
        <td><span class="cm ${vc}">${iv}</span>${ph}</td>
        <td><span class="cm" style="${pcol}">${pc}</span></td>
        <td><span class="badge ${b.cls}"><span class="dot ${b.dot}"></span>${b.lbl}</span></td>
      </tr>`;
    }).join('');
    const sections = cfgRuntime.ui?.show_sections || {};
    const showTable = sections.table !== false;
    const showBkw = sections.bkw !== false;
    const showCosts = sections.costs !== false;
    const showAmortization = sections.amortization !== false;
    const showWarnings = cfgRuntime.ui?.show_warnings !== false;
    const bkwDaysText = daysSinceBkw !== null
      ? daysSinceBkw + ' ' + this._t('bkw_days_suffix', 'Tage in Betrieb', 'days in operation')
      : this._t('bkw_days_unknown', 'Betriebstage unbekannt', 'operating days unknown');
    const bkwStartShort = bkw.validStart
      ? bkwStart.toLocaleDateString(cfgRuntime.locale || 'de-DE', { month: 'short', year: 'numeric' })
      : this._t('bkw_invalid_start_short', 'Startdatum ung�ltig', 'Invalid start date');
    const bkwHints = [];
    const missingSensors = [];
    if (!cfg.entity_solar_today) missingSensors.push('entity_solar_today_kwh');
    if (!cfg.entity_solar_total) missingSensors.push('entity_solar_total_kwh');
    if (!cfg.entity_solar_export) missingSensors.push('entity_solar_export_kwh');
    if (missingSensors.length) {
      bkwHints.push(this._t('bkw_hint_missing_prefix', 'Fehlende Konfiguration: ', 'Missing configuration: ') + missingSensors.join(', '));
    }
    const unavailableSensors = [];
    if (cfg.entity_solar_today && bkw.solarToday === null) unavailableSensors.push(cfg.entity_solar_today);
    if (cfg.entity_solar_total && bkw.solarGesamt === null) unavailableSensors.push(cfg.entity_solar_total);
    if (cfg.entity_solar_export && bkw.solarExport === null) unavailableSensors.push(cfg.entity_solar_export);
    if (unavailableSensors.length) {
      bkwHints.push(this._t('bkw_hint_unavailable_prefix', 'Sensor ohne g�ltigen Zahlenwert: ', 'Sensor without valid numeric value: ') + unavailableSensors.join(', '));
    }
    if (!bkw.validStart) {
      bkwHints.push(this._t('bkw_hint_invalid_date', 'Ung�ltiges BKW-Startdatum. Bitte bkw.start_date (oder bkw_start_datum) als ISO-Datum setzen.', 'Invalid balcony PV start date. Please set bkw.start_date (or bkw_start_datum) as ISO date.'));
    }
    const bkwHintHtml = bkwHints.length
      ? `<div class="hint">${bkwHints.join('<br>')}</div>`
      : '';
    const warningsHtml = showWarnings && warnings.length
      ? `<div class="warn-block"><div class="warn-title">${this._t('warn_title', 'Plausibilit�ts-Hinweise', 'Plausibility notes')}</div><div class="warn-list">${warnings.map((w) => `<div class="warn-item">� ${w}</div>`).join('')}</div></div>`
      : '';
    const tableHtml = showTable ? this._renderTableSection(cfgRuntime, tr, green, red, orange, gray) : '';
    const bkwHtml = showBkw ? this._renderBkwSection(
      cfgRuntime, bkwHintHtml, bkwDaysText, d, solarHeuteEur, solarGesamt,
      kwhTotalProTag, solarSelf, solarExport, svQuote, kwhSelfProTag, eurProTag
    ) : '';
    const costsHtml = showCosts ? this._renderCostsSection(cfgRuntime, costs) : '';
    const amortizationHtml = showAmortization
      ? this._renderAmortizationSection(cfgRuntime, daysSinceBkw, gespartEur, restBetrag, amortization, amortStr, amortJahre, barCol, pct, bkwStartShort)
      : '';

    // ── HTML rendern ────────────────────────────────────────────────────────────
    this.shadowRoot.innerHTML = `
<style>
:host { display: block; }
.card { background: var(--card-background-color, #1c1c1e); border-radius: 12px; overflow: hidden; font-family: var(--primary-font-family, sans-serif); }
.hdr { background: #0d2e12; padding: 16px 24px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
.hdr-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; }
.ttl { font-size: 17px; font-weight: 700; color: #e8f5e9; margin: 0 0 3px; }
.stl { font-size: 12px; color: rgba(200,230,201,.65); margin: 0; }
.snd { font-size: 11px; color: rgba(200,230,201,.45); text-align: right; }
.ctr { display: flex; border-bottom: 1px solid rgba(255,255,255,.07); }
.ct { display: flex; flex-direction: column; align-items: center; flex: 1; padding: 14px 8px; border-right: 1px solid rgba(255,255,255,.06); }
.ct:last-child { border-right: none; }
.cv { font-size: 28px; font-weight: 700; line-height: 1; }
.cv.g { color: #4ade80; } .cv.r { color: #f87171; } .cv.o { color: #fbbf24; } .cv.x { color: #9ca3af; }
.cl { font-size: 10px; color: rgba(255,255,255,.4); margin-top: 4px; letter-spacing: .06em; text-transform: uppercase; }
.tw { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
thead th { padding: 10px 18px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: rgba(255,255,255,.3); border-bottom: 2px solid rgba(255,255,255,.1); white-space: nowrap; }
tbody tr { border-bottom: 1px solid rgba(255,255,255,.05); transition: background .12s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: rgba(255,255,255,.05); }
td { padding: 12px 18px; vertical-align: middle; }
.cm { display: block; color: var(--primary-text-color, #e5e5ea); font-weight: 600; }
.cs { display: block; font-size: 11px; color: rgba(255,255,255,.35); margin-top: 2px; }
.prog { display: block; font-size: 11px; color: #a78bfa; margin-top: 3px; }
.vg { color: #4ade80 !important; } .vr { color: #f87171 !important; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.be { background: rgba(74,222,128,.15); color: #4ade80; }
.bo { background: rgba(251,191,36,.15); color: #fbbf24; }
.br { background: rgba(248,113,113,.15); color: #f87171; }
.bg { background: rgba(156,163,175,.12); color: #9ca3af; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.de { background: #4ade80; } .do { background: #fbbf24; } .dr { background: #f87171; } .dg { background: #9ca3af; }
.bkw-block { border-top: 2px solid rgba(251,191,36,.3); background: rgba(251,191,36,.04); }
.bkw-hdr { padding: 14px 18px 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #fbbf24; }
.bkw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: rgba(255,255,255,.05); margin-top: 12px; }
.bkw-item { display: flex; flex-direction: column; gap: 3px; padding: 14px 18px; background: var(--card-background-color, #1c1c1e); }
.bkw-lbl { font-size: 10px; color: rgba(255,255,255,.38); font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.bkw-val { font-size: 17px; font-weight: 700; }
.bkw-sub { font-size: 11px; color: rgba(255,255,255,.3); }
.bkw-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; margin-top: 4px; background: rgba(74,222,128,.15); color: #4ade80; }
.kosten-block { border-top: 2px solid rgba(248,113,113,.3); background: rgba(248,113,113,.04); }
.kosten-hdr { padding: 14px 18px 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #f87171; }
.kosten-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1px; background: rgba(255,255,255,.05); margin-top: 12px; }
.kosten-item { display: flex; flex-direction: column; gap: 3px; padding: 14px 18px; background: var(--card-background-color, #1c1c1e); }
.kosten-lbl { font-size: 10px; color: rgba(255,255,255,.38); font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.kosten-val { font-size: 17px; font-weight: 700; color: var(--primary-text-color, #e5e5ea); }
.kosten-sub { font-size: 11px; color: rgba(255,255,255,.3); }
.amor-block { border-top: 2px solid rgba(96,165,250,.25); background: rgba(96,165,250,.04); padding: 18px 24px 20px; }
.amor-hdr { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #60a5fa; margin-bottom: 16px; }
.amor-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
.amor-stat { display: flex; flex-direction: column; gap: 3px; }
.amor-lbl { font-size: 10px; color: rgba(255,255,255,.35); text-transform: uppercase; letter-spacing: .06em; }
.amor-val { font-size: 18px; font-weight: 700; }
.amor-sub { font-size: 11px; color: rgba(255,255,255,.3); }
.bar-wrap { height: 32px; background: rgba(255,255,255,.07); border-radius: 16px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 16px; display: flex; align-items: center; justify-content: flex-end; padding-right: 12px; font-size: 12px; font-weight: 700; color: #000; min-width: 50px; transition: width 1.2s ease; }
.bar-labels { display: flex; justify-content: space-between; margin-top: 7px; font-size: 10px; color: rgba(255,255,255,.28); }
.ftr { padding: 10px 18px; font-size: 10px; color: rgba(255,255,255,.25); border-top: 1px solid rgba(255,255,255,.07); display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.li { display: flex; align-items: center; gap: 5px; }
.hint { margin: 10px 18px 0; padding: 8px 10px; border: 1px solid rgba(251,191,36,.3); background: rgba(251,191,36,.08); border-radius: 8px; font-size: 11px; color: rgba(255,255,255,.85); }
.warn-block { margin: 12px 18px 0; padding: 10px 12px; border: 1px solid rgba(248,113,113,.35); background: rgba(248,113,113,.12); border-radius: 9px; }
.warn-title { font-size: 11px; font-weight: 700; color: #fca5a5; letter-spacing: .03em; text-transform: uppercase; margin-bottom: 6px; }
.warn-list { display: grid; gap: 4px; }
.warn-item { font-size: 12px; color: rgba(255,255,255,.9); }
</style>
`;

    // ── HTML Body ───────────────────────────────────────────────────────────────
    const showHeaderYears = !!(cfg.meta?.has_reference_year || cfg.meta?.has_report_year);
    const rightHeaderTop = showHeaderYears
      ? `${this._t('reference_year_label', 'Referenzjahr', 'Reference year')}: ${cfg.referenzjahr}&nbsp;&middot;&nbsp;${this._t('report_year_label', 'Berichtsjahr', 'Report year')}: ${cfg.berichtsjahr}<br>`
      : '';
    const showFooterDetails = !!(cfg.meta?.has_einzug_datum || cfg.meta?.has_year_start_kwh);
    const yearTargetText = Number.isFinite(cfg.jahresziel)
      ? cfg.jahresziel.toLocaleString(cfg.locale || 'de-DE') + ' kWh'
      : '�';
    const footerMeter = cfg.meta?.has_year_start_kwh
      ? `${this._t('meter_reading_label', 'Z�hlerstand', 'Meter reading')}: ${curStr}`
      : '';
    const footerMoveIn = cfg.meta?.has_einzug_datum
      ? `${this._t('move_in_label', 'Einzug', 'Move-in')} ${cfg.einzug_datum}`
      : '';
    const footerYearTarget = cfg.meta?.has_targets_config
      ? `${this._t('year_target_label', 'Jahresziel', 'Year target')}: ${yearTargetText}`
      : '';
    const footerParts = [footerMeter, footerMoveIn, footerYearTarget].filter(Boolean);
    const footerDetailsHtml = showFooterDetails
      ? `<span style="margin-left:auto; color:rgba(255,255,255,.4); font-weight:600">
      ${footerParts.join(' &nbsp;&middot;&nbsp; ')}
    </span>`
      : '';

    this.shadowRoot.innerHTML += `
<div class="card">
  <div class="hdr">
    <div class="hdr-top">
      <div><p class="ttl">${cfg.title}</p>${cfg.subtitle ? `<p class="stl">${cfg.subtitle}</p>` : ''}</div>
      <span class="snd">${rightHeaderTop}${this._t('as_of_label', 'Stand', 'As of')}: ${stand}</span>
    </div>
  </div>

  ${tableHtml}

  ${bkwHtml}

  ${costsHtml}

  ${amortizationHtml}

  ${warningsHtml}

  <div class="ftr">
    <span class="li"><span class="dot de"></span>${this._t('legend_saving_prefix', 'Einsparung =', 'Saving =')} ${cfg.good_threshold_pct.toFixed(1).replace('.', ',')} %</span>
    <span class="li"><span class="dot dr"></span>${this._t('legend_overuse_prefix', 'Mehrverbrauch >', 'Overuse >')} ${cfg.warn_threshold_pct.toFixed(1).replace('.', ',')} %</span>
    <span class="li"><span class="dot do"></span>${this._t('legend_tolerance', 'Toleranzbereich dazwischen', 'Tolerance range in between')}</span>
    ${footerDetailsHtml}
  </div>
</div>`;
  } // _paint()
}

if (!customElements.get('energie-monitoring-card')) {
  customElements.define('energie-monitoring-card', EnergieMonitoringCard);
}


window.customCards = window.customCards || [];
window.customCards.push({
  type: 'energie-monitoring-card',
  name: 'Energie Monitoring Card',
  description: 'Energie-Monitoring fuer Strom (inkl. Soll/Ist, Ziele und Erweiterungen)'
});







