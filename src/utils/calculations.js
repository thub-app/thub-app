// THUB Calculations - Pharmacokinetic calculations

// PK parameters based on ester, method, oil, site, volume
export const getPkParameters = (compoundId, method, oilType, site, volumeMl) => {
  // Base parameters by ester
  const esterParams = {
    'test_p': { 
      halfLife: { min: 0.8, base: 1.0, max: 1.2 },
      tmax: { min: 0.5, base: 0.75, max: 1.0 }
    },
    'test_e': { 
      halfLife: { min: 4.0, base: 4.5, max: 5.0 },
      tmax: { min: 1.0, base: 1.5, max: 2.0 }
    },
    'test_c': { 
      halfLife: { min: 5.0, base: 5.5, max: 6.0 },
      tmax: { min: 1.5, base: 2.0, max: 2.5 }
    },
    'hcg': { 
      halfLife: { min: 1.0, base: 1.5, max: 2.0 },
      tmax: { min: 0.5, base: 1.0, max: 1.5 }
    },
    'test_u': { 
      halfLife: { min: 18.0, base: 21.0, max: 24.0 },
      tmax: { min: 5.0, base: 7.0, max: 9.0 }
    },
  };

  // Method modifiers (affects absorption rate)
  const methodModifier = {
    'im': { absorption: 1.0, bioavailability: 0.70 },
    'subq': { absorption: 1.12, bioavailability: 0.82 },
  };

  // Oil type modifiers
  const oilModifier = {
    'mct': 0.95,
    'grape_seed': 1.0,
    'sesame': 1.05,
    'castor': 1.10,
    'other': 1.0,
    'unknown': 1.0,
  };

  // Site modifiers
  const siteModifier = {
    'glute': 1.08,
    'delt': 1.0,
    'quad': 1.02,
    'abdomen': 1.12,
  };

  // Volume modifier
  const getVolumeModifier = (ml) => {
    if (ml < 0.3) return 0.95;
    if (ml > 0.5) return 1.08;
    return 1.0;
  };

  // Determine ester from compound ID
  let esterKey = 'test_e';
  if (compoundId.includes('test_p') || compoundId.includes('prop')) esterKey = 'test_p';
  else if (compoundId.includes('test_c') || compoundId.includes('cyp')) esterKey = 'test_c';
  else if (compoundId.includes('test_u') || compoundId.includes('undec')) esterKey = 'test_u';
  else if (compoundId.includes('test_e') || compoundId.includes('enan')) esterKey = 'test_e';
  else if (compoundId.includes('hcg')) esterKey = 'hcg';

  const ester = esterParams[esterKey] || esterParams['test_e'];
  const methodMod = methodModifier[method] || methodModifier['im'];
  const oilMod = oilModifier[oilType] || 1.0;
  const siteMod = siteModifier[site] || 1.0;
  const volMod = getVolumeModifier(volumeMl);

  const totalAbsorptionMod = methodMod.absorption * oilMod * siteMod * volMod;
  
  return {
    halfLife: {
      min: ester.halfLife.min * totalAbsorptionMod,
      base: ester.halfLife.base * totalAbsorptionMod,
      max: ester.halfLife.max * totalAbsorptionMod,
    },
    tmax: {
      min: ester.tmax.min * totalAbsorptionMod,
      base: ester.tmax.base * totalAbsorptionMod,
      max: ester.tmax.max * totalAbsorptionMod,
    },
    bioavailability: methodMod.bioavailability,
    modifiers: {
      method: method === 'subq' ? 'SubQ' : 'IM',
      oil: oilType !== 'unknown' ? oilType.toUpperCase().replace('_', ' ') : null,
      site: site,
    }
  };
};

// Generate PK curve data with optional band (min/max)
export const generatePkData = (pkParams, dose, frequency, days = 42, withBand = false) => {
  const calculate = (halfLife, tmax, bio) => {
    const ka = Math.log(2) / (tmax / 3);
    const ke = Math.log(2) / halfLife;
    const data = [];
    const pointsPerDay = 12;
    
    const injectionInterval = frequency === 'ED' ? 1 : 
                              frequency === 'EOD' ? 2 : 
                              frequency === '3xW' ? 7/3 : 
                              frequency === '1xW' ? 7 :
                              frequency === '1x2W' ? 14 : 3.5;
    
    for (let i = 0; i <= days * pointsPerDay; i++) {
      const t = i / pointsPerDay;
      let concentration = 0;
      
      for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
        const injDay = injNum * injectionInterval;
        const timeSinceInj = t - injDay;
        if (timeSinceInj >= 0 && timeSinceInj < halfLife * 10) {
          const d = dose * bio;
          const c = d * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
          concentration += Math.max(0, c);
        }
      }
      
      data.push({ day: t, concentration });
    }
    return data;
  };

  const baseData = calculate(pkParams.halfLife.base, pkParams.tmax.base, pkParams.bioavailability);
  
  const steadyStateData = baseData.filter(d => d.day >= 28);
  const peakConc = Math.max(...steadyStateData.map(d => d.concentration));
  
  const normalizedData = baseData.map(d => ({
    day: d.day,
    percent: peakConc > 0 ? (d.concentration / peakConc) * 100 : 0,
  }));

  if (withBand) {
    const minData = calculate(pkParams.halfLife.min, pkParams.tmax.min, pkParams.bioavailability);
    const maxData = calculate(pkParams.halfLife.max, pkParams.tmax.max, pkParams.bioavailability);
    
    const minPeak = Math.max(...minData.filter(d => d.day >= 28).map(d => d.concentration));
    const maxPeak = Math.max(...maxData.filter(d => d.day >= 28).map(d => d.concentration));
    
    return normalizedData.map((d, i) => ({
      ...d,
      percentMin: minPeak > 0 ? (minData[i].concentration / minPeak) * 100 : 0,
      percentMax: maxPeak > 0 ? (maxData[i].concentration / maxPeak) * 100 : 0,
    }));
  }

  return normalizedData;
};

// Calculate stability with range
export const calculateStabilityWithRange = (pkParams, dose, frequency) => {
  const calculateForParams = (halfLife, tmax, bio) => {
    const ka = Math.log(2) / (tmax / 3);
    const ke = Math.log(2) / halfLife;
    const injectionInterval = frequency === 'ED' ? 1 : 
                              frequency === 'EOD' ? 2 : 
                              frequency === '3xW' ? 7/3 : 
                              frequency === '1xW' ? 7 :
                              frequency === '1x2W' ? 14 : 3.5;
    
    const concentrations = [];
    const pointsPerDay = 24;
    for (let i = 28 * pointsPerDay; i <= 42 * pointsPerDay; i++) {
      const t = i / pointsPerDay;
      let concentration = 0;
      
      for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
        const injDay = injNum * injectionInterval;
        const timeSinceInj = t - injDay;
        if (timeSinceInj >= 0 && timeSinceInj < halfLife * 10) {
          const d = dose * bio;
          const c = d * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
          concentration += Math.max(0, c);
        }
      }
      concentrations.push(concentration);
    }
    
    const peak = Math.max(...concentrations);
    const trough = Math.min(...concentrations);
    const fluctuation = peak > 0 ? ((peak - trough) / peak) * 100 : 0;
    return { stability: Math.round(100 - fluctuation), fluctuation: Math.round(fluctuation), troughPercent: Math.round((trough / peak) * 100) };
  };

  const base = calculateForParams(pkParams.halfLife.base, pkParams.tmax.base, pkParams.bioavailability);
  const min = calculateForParams(pkParams.halfLife.min, pkParams.tmax.min, pkParams.bioavailability);
  const max = calculateForParams(pkParams.halfLife.max, pkParams.tmax.max, pkParams.bioavailability);

  return {
    stability: { min: Math.min(min.stability, max.stability), base: base.stability, max: Math.max(min.stability, max.stability) },
    fluctuation: { min: Math.min(min.fluctuation, max.fluctuation), base: base.fluctuation, max: Math.max(min.fluctuation, max.fluctuation) },
    troughPercent: { min: Math.min(min.troughPercent, max.troughPercent), base: base.troughPercent, max: Math.max(min.troughPercent, max.troughPercent) },
  };
};
