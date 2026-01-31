import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from './supabaseClient';

const THUBApp = () => {
  // ============ STORAGE (localStorage for local/production) ============
  const loadFromStorage = (key, defaultValue) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  const saveToStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };

  // ============ MIGRATION ============
  const migrateCompoundId = (oldId) => {
    const migrations = {
      'test_c_e_200': 'test_e_200',
      'test_c_e_250': 'test_e_250',
    };
    return migrations[oldId] || oldId;
  };

  const migrateProfile = (saved) => {
    if (!saved) return saved;
    if (saved.protocol && saved.protocol.compound) {
      const newCompoundId = migrateCompoundId(saved.protocol.compound);
      if (newCompoundId !== saved.protocol.compound) {
        saved.protocol.compound = newCompoundId;
        saveToStorage('thub-profile', saved);
      }
    }
    return saved;
  };

  // ============ PK PARAMETERS ============
  // Pharmacokinetic parameters based on ester, method, oil, site, volume
  const getPkParameters = (compoundId, method, oilType, site, volumeMl) => {
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
    };

    // Method modifiers (affects absorption rate)
    const methodModifier = {
      'im': { absorption: 1.0, bioavailability: 0.70 },
      'subq': { absorption: 1.12, bioavailability: 0.82 },
    };

    // Oil type modifiers
    const oilModifier = {
      'mct': 0.95,        // 5% faster
      'grape_seed': 1.0,  // baseline
      'sesame': 1.05,     // 5% slower
      'castor': 1.10,     // 10% slower
      'other': 1.0,
      'unknown': 1.0,
    };

    // Site modifiers
    const siteModifier = {
      'glute': 1.08,      // larger muscle, slower
      'delt': 1.0,        // baseline
      'quad': 1.02,       // slightly slower
      'abdomen': 1.12,    // SubQ typical site, slower
    };

    // Volume modifier
    const getVolumeModifier = (ml) => {
      if (ml < 0.3) return 0.95;   // faster absorption
      if (ml > 0.5) return 1.08;   // slower absorption
      return 1.0;
    };

    // Determine ester from compound ID
    let esterKey = 'test_e'; // default
    if (compoundId.includes('test_p') || compoundId.includes('prop')) esterKey = 'test_p';
    else if (compoundId.includes('test_c') || compoundId.includes('cyp')) esterKey = 'test_c';
    else if (compoundId.includes('test_e') || compoundId.includes('enan')) esterKey = 'test_e';
    else if (compoundId.includes('hcg')) esterKey = 'hcg';

    const ester = esterParams[esterKey] || esterParams['test_e'];
    const methodMod = methodModifier[method] || methodModifier['im'];
    const oilMod = oilModifier[oilType] || 1.0;
    const siteMod = siteModifier[site] || 1.0;
    const volMod = getVolumeModifier(volumeMl);

    // Calculate adjusted parameters
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
        oil: (oilType && oilType !== 'unknown') ? oilType.toUpperCase().replace('_', ' ') : null,
        site: site,
      }
    };
  };

  // Generate PK curve data with optional band (min/max)
  const generatePkData = (pkParams, dose, frequency, days = 42, withBand = false) => {
    const calculate = (halfLife, tmax, bio) => {
      const ka = Math.log(2) / (tmax / 3);
      const ke = Math.log(2) / halfLife;
      const data = [];
      const pointsPerDay = 12; // 12 points per day = every 2 hours
      
      const injectionInterval = frequency === 'ED' ? 1 : 
                                frequency === 'EOD' ? 2 : 
                                frequency === '3xW' ? 7/3 : 3.5;
      
      for (let i = 0; i <= days * pointsPerDay; i++) {
        const t = i / pointsPerDay;
        let concentration = 0;
        
        for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
          const injDay = injNum * injectionInterval;
          const timeSinceInj = t - injDay;
          if (timeSinceInj >= 0 && timeSinceInj < 30) {
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
    
    // Find peak in steady state (days 28-42) for normalization
    const steadyStateData = baseData.filter(d => d.day >= 28);
    const peakConc = Math.max(...steadyStateData.map(d => d.concentration));
    
    // Normalize to 0-100% (no rounding for smooth curve)
    const normalizedData = baseData.map(d => ({
      day: d.day,
      percent: peakConc > 0 ? (d.concentration / peakConc) * 100 : 0,
    }));

    if (withBand) {
      const minData = calculate(pkParams.halfLife.min, pkParams.tmax.min, pkParams.bioavailability);
      const maxData = calculate(pkParams.halfLife.max, pkParams.tmax.max, pkParams.bioavailability);
      
      // Find peaks for each
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
  const calculateStabilityWithRange = (pkParams, dose, frequency) => {
    const calculateForParams = (halfLife, tmax, bio) => {
      const ka = Math.log(2) / (tmax / 3);
      const ke = Math.log(2) / halfLife;
      const injectionInterval = frequency === 'ED' ? 1 : 
                                frequency === 'EOD' ? 2 : 
                                frequency === '3xW' ? 7/3 : 3.5;
      
      const concentrations = [];
      const pointsPerDay = 24; // More points for accurate peak/trough detection
      for (let i = 28 * pointsPerDay; i <= 42 * pointsPerDay; i++) {
        const t = i / pointsPerDay;
        let concentration = 0;
        
        for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
          const injDay = injNum * injectionInterval;
          const timeSinceInj = t - injDay;
          if (timeSinceInj >= 0 && timeSinceInj < 30) {
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

  // ============ STATE ============
  // ============ AUTH/SESSION STATE ============
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [currentStep, setCurrentStep] = useState(() => {
    const saved = migrateProfile(loadFromStorage('thub-profile', null));
    if (!saved || !saved.name) return 'onboarding';
    if (!saved.protocolConfigured) return 'protocol';
    return 'main';
  });

  const [profile, setProfile] = useState(() => migrateProfile(loadFromStorage('thub-profile', {
    name: '',
    email: '',
    password: '',
    rememberMe: false,
    protocolConfigured: false
  })));

  const [protocolData, setProtocolData] = useState(() => {
    const saved = migrateProfile(loadFromStorage('thub-profile', null));
    if (saved && saved.protocol) return {
      ...saved.protocol,
      source: saved.protocol.source || 'unknown',
      oilType: saved.protocol.oilType || 'unknown',
      injectionMethod: saved.protocol.injectionMethod || 'im',
      injectionLocation: saved.protocol.injectionLocation || 'glute'
    };
    return {
      compound: 'test_e_200',
      weeklyDose: 150,
      frequency: 'EOD',
      graduation: 2,
      startDate: new Date().toISOString().split('T')[0],
      source: 'unknown',
      oilType: 'unknown',
      injectionMethod: 'im',
      injectionLocation: 'glute'
    };
  });

  const [injections, setInjections] = useState(() => loadFromStorage('thub-injections', {}));

  // Location state - помни последната използвана локация и страна
  const [selectedLocation, setSelectedLocation] = useState(() => {
    const saved = loadFromStorage('thub-injections', {});
    const keys = Object.keys(saved).sort().reverse();
    for (const key of keys) {
      if (saved[key]?.location) return saved[key].location;
    }
    return 'glute';
  });

  const [selectedSide, setSelectedSide] = useState(() => {
    const saved = loadFromStorage('thub-injections', {});
    const keys = Object.keys(saved).sort().reverse();
    for (const key of keys) {
      if (saved[key]?.side) return saved[key].side;
    }
    return 'left';
  });

  // Location modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingLocation, setPendingLocation] = useState(null);

  const [formData, setFormData] = useState(() => {
    const saved = migrateProfile(loadFromStorage('thub-profile', null));
    // За Sign In - полетата започват празни, браузърът прави autocomplete
    // За Sign Up - също празни
    return {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      rememberMe: true
    };
  });

  const [errors, setErrors] = useState({});
  const [authMode, setAuthMode] = useState(() => {
    const saved = loadFromStorage('thub-profile', null);
    return saved?.name ? 'signin' : 'signup';
  });
  const [activeTab, setActiveTab] = useState('today');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [ticker, setTicker] = useState(0); // For auto-refresh "NOW" status

  // Auto-refresh every minute for live "NOW" status
  useEffect(() => {
    const interval = setInterval(() => {
      setTicker(prev => prev + 1);
    }, 60 * 1000); // Every 60 seconds
    return () => clearInterval(interval);
  }, []);

  // Modal state за потвърждение на промени
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [detectedChanges, setDetectedChanges] = useState([]);
  const [changeReason, setChangeReason] = useState('');
  
  // Calendar modals
  const [selectedDate, setSelectedDate] = useState(null);
  const [showInjectionModal, setShowInjectionModal] = useState(false);
  const [showAddInjectionModal, setShowAddInjectionModal] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [injectionFormData, setInjectionFormData] = useState({
    time: '09:00',
    dose: 0,
    location: 'delt',
    side: 'left'
  });

  // Save injections when changed
  useEffect(() => {
    saveToStorage('thub-injections', injections);
  }, [injections]);


  // ============ SUPABASE AUTH ============
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ============ PROTOCOL CHANGE DETECTION ============
  const compoundNames = {
    'test_c_200': 'Testosterone Cypionate 200mg/mL',
    'test_e_200': 'Testosterone Enanthate 200mg/mL',
    'test_e_250': 'Testosterone Enanthate 250mg/mL',
    'test_c_250': 'Testosterone Cypionate 250mg/mL',
    'test_p_100': 'Testosterone Propionate 100mg/mL',
    'hcg': 'HCG 5000IU / 5mL',
  };

  const frequencyNames = {
    'ED': 'Всеки ден',
    'EOD': 'През ден',
    '3xW': '3× седмично',
    '2xW': '2× седмично',
  };

  const detectProtocolChanges = (oldProto, newProto) => {
    if (!oldProto) return [];
    
    const changes = [];
    
    if (oldProto.compound !== newProto.compound) {
      changes.push({
        field: 'Препарат',
        from: compoundNames[oldProto.compound] || oldProto.compound,
        to: compoundNames[newProto.compound] || newProto.compound
      });
    }
    
    if (oldProto.weeklyDose !== newProto.weeklyDose) {
      changes.push({
        field: 'Седмична доза',
        from: `${oldProto.weeklyDose} mg`,
        to: `${newProto.weeklyDose} mg`
      });
    }
    
    if (oldProto.frequency !== newProto.frequency) {
      changes.push({
        field: 'Честота',
        from: frequencyNames[oldProto.frequency] || oldProto.frequency,
        to: frequencyNames[newProto.frequency] || newProto.frequency
      });
    }
    
    if (oldProto.graduation !== newProto.graduation) {
      changes.push({
        field: 'Скала',
        from: `${oldProto.graduation}U`,
        to: `${newProto.graduation}U`
      });
    }
    
    if (oldProto.startDate !== newProto.startDate) {
      changes.push({
        field: 'Начална дата',
        from: oldProto.startDate,
        to: newProto.startDate
      });
    }

    if (oldProto.source !== newProto.source) {
      const sourceLabels = { pharmacy: 'Аптека', ugl: 'UGL', unknown: 'Не знам' };
      changes.push({
        field: 'Източник',
        from: sourceLabels[oldProto.source] || oldProto.source,
        to: sourceLabels[newProto.source] || newProto.source
      });
    }

    if (oldProto.oilType !== newProto.oilType) {
      const oilLabels = { mct: 'MCT', grape_seed: 'Grape Seed', sesame: 'Sesame', castor: 'Castor', other: 'Друго', unknown: 'Не знам' };
      changes.push({
        field: 'Масло',
        from: oilLabels[oldProto.oilType] || oldProto.oilType,
        to: oilLabels[newProto.oilType] || newProto.oilType
      });
    }

    if (oldProto.injectionMethod !== newProto.injectionMethod) {
      const methodLabels = { im: 'IM', subq: 'SubQ' };
      changes.push({
        field: 'Метод',
        from: methodLabels[oldProto.injectionMethod] || oldProto.injectionMethod,
        to: methodLabels[newProto.injectionMethod] || newProto.injectionMethod
      });
    }
    
    return changes;
  };

  // ============ VALIDATION ============
  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validateOnboarding = () => {
    const newErrors = {};
    
    if (authMode === 'signup') {
      if (formData.name.trim().length < 2) {
        newErrors.name = 'Минимум 2 символа';
      }
      if (formData.password && formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Паролите не съвпадат';
      }
    }
    
    if (!validateEmail(formData.email)) {
      newErrors.email = 'Невалиден имейл';
    }
    
    if (!formData.password || formData.password.length < 6) {
      newErrors.password = 'Минимум 6 символа';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Reset function

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setInjections({});
    setCurrentStep('onboarding');
  };

  const resetApp = () => {
    try {
      localStorage.removeItem('thub-profile');
      localStorage.removeItem('thub-injections');
    } catch (e) {}
    window.location.reload();
  };

  // ============ DEMO MODE ============
  const loadDemo = () => {
    const demoProfile = {
      name: 'Demo User',
      email: 'demo@thub.bg',
      password: 'demo123',
      rememberMe: true,
      protocolConfigured: true,
      createdAt: new Date().toISOString(),
      protocol: {
        compound: 'test_e_250',
        weeklyDose: 150,
        frequency: 'EOD',
        graduation: 2,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: 'pharmacy',
        oilType: 'mct',
        injectionMethod: 'im',
        injectionLocation: 'glute'
      }
    };
    
    // Генерираме няколко инжекции за последните 2 седмици
    const demoInjections = {};
    const startDate = new Date(demoProfile.protocol.startDate);
    for (let i = 0; i < 14; i += 2) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      if (date <= new Date()) {
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        demoInjections[key] = { time: '08:00', dose: 30 };
      }
    }
    
    setProfile(demoProfile);
    setProtocolData(demoProfile.protocol);
    setInjections(demoInjections);
    saveToStorage('thub-profile', demoProfile);
    saveToStorage('thub-injections', demoInjections);
    setCurrentStep('main');
    setActiveTab('today');
  };

  // ============ ACTIONS ============

  const handleOnboardingSubmit = async () => {
    if (authMode === 'signup') {
      // SIGN UP with Supabase
      if (validateOnboarding()) {
        setAuthLoading(true);
        
        const { data, error } = await supabase.auth.signUp({
          email: formData.email.trim(),
          password: formData.password,
        });
        
        if (error) {
          setErrors({ general: error.message });
          setAuthLoading(false);
          return;
        }
        
        // Create profile in localStorage (for now)
        const newProfile = {
          name: formData.name.trim(),
          email: formData.email.trim(),
          rememberMe: true,
          protocolConfigured: false,
          createdAt: new Date().toISOString()
        };
        setProfile(newProfile);
        saveToStorage('thub-profile-' + formData.email, newProfile);
        setCurrentStep('protocol');
        setAuthLoading(false);
      }
    } else {
      // SIGN IN with Supabase
      if (validateOnboarding()) {
        setAuthLoading(true);
        
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
        });
        
        if (error) {
          setErrors({ general: 'Грешен имейл или парола' });
          setAuthLoading(false);
          return;
        }
        
        // Load profile from localStorage
        const savedProfile = loadFromStorage('thub-profile-' + formData.email, null);
        
        if (savedProfile && savedProfile.protocolConfigured && savedProfile.protocol) {
          setProfile(savedProfile);
          setProtocolData(savedProfile.protocol);
          setActiveTab('today');
          setCurrentStep('main');
        } else {
          // First time or no protocol - set up
          const newProfile = {
            name: savedProfile?.name || '',
            email: formData.email.trim(),
            rememberMe: formData.rememberMe || false,
            protocolConfigured: false,
            createdAt: savedProfile?.createdAt || new Date().toISOString()
          };
          setProfile(newProfile);
          saveToStorage('thub-profile-' + formData.email, newProfile);
          setCurrentStep('protocol');
        }
        
        setAuthLoading(false);
      }
    }
  };


  const handleProtocolSubmit = () => {
    // Ако вече има запазен протокол, проверяваме за промени
    if (profile.protocolConfigured && profile.protocol) {
      const changes = detectProtocolChanges(profile.protocol, protocolData);
      
      if (changes.length > 0) {
        // Има промени - показваме modal за потвърждение
        setDetectedChanges(changes);
        setChangeReason('');
        setShowChangeModal(true);
        return;
      }
    }
    
    // Няма промени или е нов протокол - запазваме директно
    saveProtocol();
  };

  const saveProtocol = (reason = null) => {
    const now = new Date().toISOString();
    
    // Подготвяме history entry ако има промени
    let newHistory = profile.protocolHistory || [];
    
    if (reason && profile.protocol) {
      const historyEntry = {
        date: now,
        reason: reason,
        changes: detectedChanges.map(c => `${c.field}: ${c.from} → ${c.to}`).join(', '),
        oldProtocol: { ...profile.protocol },
        newProtocol: { ...protocolData }
      };
      newHistory = [...newHistory, historyEntry];
    }
    
    const newProfile = {
      ...profile,
      protocol: protocolData,
      protocolConfigured: true,
      protocolHistory: newHistory,
      lastModified: now
    };
    
    setProfile(newProfile);
    saveToStorage('thub-profile', newProfile);
    setShowChangeModal(false);
    setDetectedChanges([]);
    setChangeReason('');
    setCurrentStep('main');
  };

  const cancelProtocolChange = () => {
    // Връщаме protocolData към оригиналния протокол
    if (profile.protocol) {
      setProtocolData({ ...profile.protocol });
    }
    setShowChangeModal(false);
    setDetectedChanges([]);
    setChangeReason('');
  };

  // ============ RENDER ============
  
  // Onboarding Screen
  if (currentStep === 'onboarding') {
    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="flex flex-col lg:flex-row items-center justify-center p-6 lg:p-12 gap-6">
        
        {/* Left Panel - Branding & Info */}
        <div 
          style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
          className="w-full lg:w-1/2 max-w-xl border rounded-3xl p-8 lg:p-12"
        >
          {/* Logo */}
          <div 
            style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
            className="w-20 h-20 rounded-2xl border-2 flex items-center justify-center mb-6 shadow-xl"
          >
            <span className="text-white text-lg font-black tracking-tight">THUB</span>
          </div>
          
          {/* Brand tag */}
          <p style={{ color: '#22d3ee' }} className="text-sm font-semibold tracking-widest mb-4">THUB.BG</p>
          
          {/* Main headline */}
          <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight mb-6">
            TRT Protocol Management
          </h1>
          
          {/* Description - placeholder */}
          <p style={{ color: '#64748b' }} className="text-base leading-relaxed mb-8">
            Прецизно дозиране с U-100 спринцовки. Оптимизация на инжекционния график. Проследяване на симптоми и прогрес. Всичко на едно място.
          </p>
          
          {/* CTA Button - placeholder for marketing */}
          <button
            style={{ borderColor: '#1e3a5f', color: '#94a3b8' }}
            className="w-full py-4 border rounded-xl font-medium hover:bg-white/5 transition-colors"
          >
            Научи повече за THUB →
          </button>
        </div>

        {/* Right Panel - Auth Form */}
        <div className="w-full lg:w-1/2 max-w-md">
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-3xl p-8 shadow-2xl"
          >
            {/* Header with tabs */}
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-white">
                {authMode === 'signup' ? 'Welcome' : 'Welcome back'}
              </h2>
              <div 
                style={{ backgroundColor: '#0a1628' }}
                className="flex rounded-lg p-1"
              >
                <button
                  onClick={() => setAuthMode('signin')}
                  style={{ 
                    backgroundColor: authMode === 'signin' ? '#1e3a5f' : 'transparent',
                    color: authMode === 'signin' ? 'white' : '#64748b'
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={() => setAuthMode('signup')}
                  style={{ 
                    backgroundColor: authMode === 'signup' ? '#1e3a5f' : 'transparent',
                    color: authMode === 'signup' ? 'white' : '#64748b'
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Sign-up
                </button>
              </div>
            </div>

            <form 
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleOnboardingSubmit();
              }}
            >
              {/* Sign Up Fields */}
              {authMode === 'signup' && (
                <>
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                      Име
                    </label>
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData(prev => ({ ...prev, name: e.target.value }));
                        if (errors.name) setErrors(prev => ({ ...prev, name: null }));
                      }}
                      style={{ 
                        backgroundColor: '#0a1628', 
                        borderColor: errors.name ? '#ef4444' : '#1e3a5f',
                        color: 'white'
                      }}
                      className="w-full px-4 py-3 border rounded-xl focus:outline-none transition-colors"
                    />
                    {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
                  </div>
                </>
              )}

              {/* Email - both modes */}
              <div>
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                  Имейл
                </label>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="твоят@имейл.com"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, email: e.target.value }));
                    if (errors.email) setErrors(prev => ({ ...prev, email: null }));
                  }}
                  style={{ 
                    backgroundColor: '#0a1628', 
                    borderColor: errors.email ? '#ef4444' : '#1e3a5f',
                    color: 'white'
                  }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none transition-colors"
                />
                {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
              </div>

              {/* Password - both modes */}
              <div>
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                  Парола
                </label>
                <input
                  type="password"
                  name="password"
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder="••••••"
                  value={formData.password || ''}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, password: e.target.value }));
                    if (errors.password) setErrors(prev => ({ ...prev, password: null }));
                  }}
                  style={{ 
                    backgroundColor: '#0a1628', 
                    borderColor: errors.password ? '#ef4444' : '#1e3a5f',
                    color: 'white'
                  }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none transition-colors"
                />
                {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
              </div>

              {/* Confirm Password - signup only */}
              {authMode === 'signup' && (
                <div>
                  <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                    Потвърди парола
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={formData.confirmPassword || ''}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, confirmPassword: e.target.value }));
                      if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: null }));
                    }}
                    style={{ 
                      backgroundColor: '#0a1628', 
                      borderColor: errors.confirmPassword ? '#ef4444' : '#1e3a5f',
                      color: 'white'
                    }}
                    className="w-full px-4 py-3 border rounded-xl focus:outline-none transition-colors"
                  />
                  {errors.confirmPassword && <p className="text-red-400 text-sm mt-1">{errors.confirmPassword}</p>}
                </div>
              )}

              {/* Remember me - signin only */}
              {authMode === 'signin' && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={formData.rememberMe || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, rememberMe: e.target.checked }))}
                    className="w-5 h-5 rounded"
                    style={{ accentColor: '#06b6d4' }}
                  />
                  <label htmlFor="rememberMe" style={{ color: '#94a3b8' }} className="text-sm cursor-pointer">
                    Запомни ме
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                style={{ background: 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
                className="w-full py-4 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:opacity-90 mt-2"
              >
                {authMode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>

              {/* Forgot password - signin only */}
              {authMode === 'signin' && (
                <p style={{ color: '#64748b' }} className="text-sm text-center">
                  Забравена парола?
                </p>
              )}
            </form>
            
            {/* Dev Reset Button */}
            <button
              onClick={resetApp}
              style={{ color: '#334155' }}
              className="w-full mt-6 py-2 text-xs hover:text-red-400 transition-colors"
            >
              🔄 Reset App (dev)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Protocol Setup Screen
  if (currentStep === 'protocol') {
    // Compounds
    const compounds = [
      { id: 'test_c_200', name: 'Testosterone Cypionate 200mg/mL', concentration: 200, unit: 'mg' },
      { id: 'test_e_200', name: 'Testosterone Enanthate 200mg/mL', concentration: 200, unit: 'mg' },
      { id: 'test_e_250', name: 'Testosterone Enanthate 250mg/mL', concentration: 250, unit: 'mg' },
      { id: 'test_c_250', name: 'Testosterone Cypionate 250mg/mL', concentration: 250, unit: 'mg' },
      { id: 'test_p_100', name: 'Testosterone Propionate 100mg/mL', concentration: 100, unit: 'mg' },
      { id: 'hcg', name: 'HCG 5000IU / 5mL', concentration: 1000, unit: 'IU' },
    ];

    const frequencies = [
      { id: 'ED', name: 'Всеки ден (ED)', perWeek: 7 },
      { id: 'EOD', name: 'През ден (EOD)', perWeek: 3.5 },
      { id: '3xW', name: '3× седмично (Пон/Ср/Пет)', perWeek: 3 },
      { id: '2xW', name: '2× седмично (Пон/Чет)', perWeek: 2 },
    ];

    // Get current compound and frequency
    const compound = compounds.find(c => c.id === protocolData.compound) || compounds[0];
    const freq = frequencies.find(f => f.id === protocolData.frequency) || frequencies[1];

    // Calculations
    const dosePerInjection = protocolData.weeklyDose / freq.perWeek;
    const mlPerInjection = dosePerInjection / compound.concentration;
    const unitsRaw = mlPerInjection * 100;
    const unitsRounded = Math.round(unitsRaw / protocolData.graduation) * protocolData.graduation;
    const actualMl = unitsRounded / 100;
    const actualDose = actualMl * compound.concentration;

    // Max units for display (50 for 1U scale, 100 for 2U scale)
    const maxUnits = protocolData.graduation === 1 ? 50 : 100;
    const displayUnits = Math.min(unitsRounded, maxUnits);

    // Get PK parameters based on all protocol factors
    const pkParams = getPkParameters(
      protocolData.compound,
      protocolData.injectionMethod,
      protocolData.oilType,
      protocolData.injectionLocation,
      actualMl
    );

    // Calculate stability with range
    const stabilityData = calculateStabilityWithRange(pkParams, actualDose, protocolData.frequency);

    // Generate PK data for graph with band
    const pkData = generatePkData(pkParams, actualDose, protocolData.frequency, 42, true);

    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }}>
        
        {/* Header with navigation */}
        <header 
          style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
          className="px-4 py-3 flex items-center justify-between sticky top-0 z-40 border-b"
        >
          <button
            onClick={() => setCurrentStep('onboarding')}
            style={{ color: '#64748b' }}
            className="flex items-center gap-2 hover:text-white transition-colors"
          >
            ← Назад
          </button>
          <span className="text-white font-semibold">Настройка на протокол</span>
          <button
            onClick={handleProtocolSubmit}
            style={{ color: '#22d3ee' }}
            className="font-medium"
          >
            Прескочи →
          </button>
        </header>

        {/* Content */}
        <div className="p-4 space-y-4">
          
          {/* Compound */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
              Препарат
            </label>
            <select
              value={protocolData.compound}
              onChange={(e) => setProtocolData(prev => ({ ...prev, compound: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            >
              {compounds.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Weekly Dose */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
              Седмична доза ({compound.unit})
            </label>
            <input
              type="number"
              value={protocolData.weeklyDose}
              onChange={(e) => setProtocolData(prev => ({ ...prev, weeklyDose: parseFloat(e.target.value) || 0 }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none text-lg"
            />
          </div>

          {/* Frequency */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
              Честота
            </label>
            <select
              value={protocolData.frequency}
              onChange={(e) => setProtocolData(prev => ({ ...prev, frequency: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            >
              {frequencies.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Protocol Start Date */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
              Начало на протокола
            </label>
            <input
              type="date"
              value={protocolData.startDate}
              onChange={(e) => setProtocolData(prev => ({ ...prev, startDate: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            />
          </div>

          {/* Graduation - Toggle Buttons */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">
              Скала на спринцовката
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setProtocolData(prev => ({ ...prev, graduation: 1 }))}
                style={{ 
                  backgroundColor: protocolData.graduation === 1 ? '#0891b2' : '#0a1628',
                  borderColor: protocolData.graduation === 1 ? '#0891b2' : '#1e3a5f',
                  color: 'white'
                }}
                className="flex-1 py-4 border rounded-xl font-semibold transition-colors"
              >
                <div className="text-lg">1U</div>
                <div style={{ color: protocolData.graduation === 1 ? '#cffafe' : '#64748b' }} className="text-xs">прецизна (0-50U)</div>
              </button>
              <button
                onClick={() => setProtocolData(prev => ({ ...prev, graduation: 2 }))}
                style={{ 
                  backgroundColor: protocolData.graduation === 2 ? '#0891b2' : '#0a1628',
                  borderColor: protocolData.graduation === 2 ? '#0891b2' : '#1e3a5f',
                  color: 'white'
                }}
                className="flex-1 py-4 border rounded-xl font-semibold transition-colors"
              >
                <div className="text-lg">2U</div>
                <div style={{ color: protocolData.graduation === 2 ? '#cffafe' : '#64748b' }} className="text-xs">стандарт (0-100U)</div>
              </button>
            </div>
          </div>

          {/* Injection Method */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">
              Метод на инжектиране
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setProtocolData(prev => ({ ...prev, injectionMethod: 'im' }))}
                style={{ 
                  backgroundColor: protocolData.injectionMethod === 'im' ? '#0891b2' : '#0a1628',
                  borderColor: protocolData.injectionMethod === 'im' ? '#0891b2' : '#1e3a5f',
                  color: 'white'
                }}
                className="flex-1 py-3 border rounded-xl font-medium transition-colors"
              >
                💉 IM
                <div style={{ color: protocolData.injectionMethod === 'im' ? '#cffafe' : '#64748b' }} className="text-xs">интрамускулно</div>
              </button>
              <button
                onClick={() => setProtocolData(prev => ({ ...prev, injectionMethod: 'subq' }))}
                style={{ 
                  backgroundColor: protocolData.injectionMethod === 'subq' ? '#0891b2' : '#0a1628',
                  borderColor: protocolData.injectionMethod === 'subq' ? '#0891b2' : '#1e3a5f',
                  color: 'white'
                }}
                className="flex-1 py-3 border rounded-xl font-medium transition-colors"
              >
                💧 SubQ
                <div style={{ color: protocolData.injectionMethod === 'subq' ? '#cffafe' : '#64748b' }} className="text-xs">подкожно</div>
              </button>
            </div>
          </div>

          {/* Source */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">
              Източник на препарата
            </label>
            <div className="flex gap-2">
              {[
                { id: 'pharmacy', label: '🏥 Аптека' },
                { id: 'ugl', label: '🧪 UGL' },
                { id: 'unknown', label: '❓ Не знам' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setProtocolData(prev => ({ ...prev, source: opt.id }))}
                  style={{ 
                    backgroundColor: protocolData.source === opt.id ? '#0891b2' : '#0a1628',
                    borderColor: protocolData.source === opt.id ? '#0891b2' : '#1e3a5f',
                    color: 'white'
                  }}
                  className="flex-1 py-3 border rounded-xl font-medium transition-colors text-sm"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Oil Type */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
              Вид масло (ако знаеш)
            </label>
            <select
              value={protocolData.oilType}
              onChange={(e) => setProtocolData(prev => ({ ...prev, oilType: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            >
              <option value="mct">MCT Oil</option>
              <option value="grape_seed">Grape Seed Oil</option>
              <option value="sesame">Sesame Oil</option>
              <option value="castor">Castor Oil</option>
              <option value="other">Друго</option>
              <option value="unknown">Не знам</option>
            </select>
          </div>

          {/* Syringe Preview - ORIGINAL BIG VERSION */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-6"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-4 text-center">
              Preview на дозата
            </label>
            
            <div className="flex items-center justify-center gap-8">
              {/* Big Syringe */}
              <div className="relative">
                <div 
                  style={{ backgroundColor: '#0a1628', borderColor: '#475569', width: '100px', height: '380px' }}
                  className="relative border-2 rounded-xl overflow-hidden"
                >
                  {/* Graduation marks */}
                  {(protocolData.graduation === 2
                    ? Array.from({ length: 51 }, (_, i) => i * 2)
                    : Array.from({ length: 51 }, (_, i) => i)
                  ).map(tick => {
                    const maxTick = protocolData.graduation === 2 ? 100 : 50;
                    const pos = 4 + ((maxTick - tick) / maxTick) * 92;
                    const isMajor = tick % 10 === 0;
                    const isMedium = tick % 5 === 0 && !isMajor;

                    return (
                      <div 
                        key={tick} 
                        className="absolute w-full left-0 right-0"
                        style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
                      >
                        <div className="flex items-center justify-between px-2">
                          <div 
                            style={{ 
                              backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569',
                              width: isMajor ? '16px' : isMedium ? '10px' : '6px',
                              height: isMajor ? '2px' : '1px'
                            }}
                          />
                          {isMajor && (
                            <span style={{ color: '#e2e8f0', fontSize: '11px' }} className="font-bold">{tick}</span>
                          )}
                          <div 
                            style={{ 
                              backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569',
                              width: isMajor ? '16px' : isMedium ? '10px' : '6px',
                              height: isMajor ? '2px' : '1px'
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Liquid fill */}
                  <div 
                    style={{ 
                      background: 'linear-gradient(to top, #0891b2, #06b6d4, #22d3ee)',
                      height: `${4 + (displayUnits / maxUnits) * 92}%`,
                      opacity: 0.6
                    }}
                    className="absolute bottom-0 left-0 right-0 transition-all duration-500 rounded-b-lg"
                  />
                </div>

                {/* Scale label */}
                <div style={{ color: '#64748b' }} className="text-center text-xs mt-2">
                  Скала {protocolData.graduation}U (0-{maxUnits}U)
                </div>
              </div>

              {/* Dose Info */}
              <div className="text-center">
                <div style={{ color: '#64748b' }} className="text-sm mb-1">Дръпни до</div>
                <div style={{ color: '#22d3ee' }} className="text-6xl font-bold mb-2">
                  {unitsRounded}U
                </div>
                <div style={{ color: '#64748b' }} className="space-y-1 text-sm">
                  <div>{actualDose.toFixed(1)} {compound.unit}</div>
                  <div>{actualMl.toFixed(3)} mL</div>
                </div>

                {/* Scale indicator */}
                <div 
                  style={{ backgroundColor: '#1e3a5f' }}
                  className="mt-4 px-3 py-2 rounded-lg"
                >
                  <span style={{ color: '#94a3b8' }} className="text-xs">
                    {protocolData.graduation}U = {(protocolData.graduation / 100).toFixed(2)} mL = {((protocolData.graduation / 100) * compound.concentration).toFixed(1)} {compound.unit}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* PK Graph - Normalized concentration (0-100%) with band */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-4 text-center">
              Относителна концентрация (6 седмици)
            </label>
            
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart 
                  data={pkData}
                  margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="pkGradientProtocol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="pkBandGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="day" 
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickFormatter={(v) => `${Math.round(v)}д`}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={{ stroke: '#334155' }}
                    interval={40}
                  />
                  <YAxis 
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, 110]}
                    ticks={[0, 25, 50, 75, 100]}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px' }}
                    labelStyle={{ color: '#94a3b8' }}
                    itemStyle={{ color: '#22d3ee' }}
                    formatter={(value, name) => {
                      if (name === 'percent') return [`${Math.round(value)}% от пик`, 'Концентрация'];
                      return [null, null]; // Hide other series
                    }}
                    labelFormatter={(label) => `Ден ${Math.round(label * 10) / 10}`}
                  />
                  {/* Band area (min-max range) - hidden from legend/tooltip */}
                  <Area 
                    type="natural" 
                    dataKey="percentMax"
                    stroke="none"
                    fill="url(#pkBandGradient)"
                    legendType="none"
                  />
                  {/* Main line */}
                  <Area 
                    type="natural" 
                    dataKey="percent" 
                    stroke="#06b6d4" 
                    strokeWidth={2}
                    fill="url(#pkGradientProtocol)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            <div style={{ color: '#475569' }} className="text-xs text-center mt-2">
              t½ ~{pkParams.halfLife.min.toFixed(1)}-{pkParams.halfLife.max.toFixed(1)}д │ {pkParams.modifiers.method}{pkParams.modifiers.oil ? ` │ ${pkParams.modifiers.oil}` : ''} │ Trough: ~{stabilityData.troughPercent.min}-{stabilityData.troughPercent.max}%
            </div>
          </div>

          {/* Stability Gauge */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-6"
          >
            <div className="flex items-center justify-between gap-6">
              {/* Circular Gauge */}
              <div className="relative w-32 h-32">
                <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="12"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke={stabilityData.stability.base >= 70 ? '#10b981' : stabilityData.stability.base >= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${stabilityData.stability.base * 2.51} 251`}
                    style={{
                      filter: `drop-shadow(0 0 8px ${stabilityData.stability.base >= 70 ? 'rgba(16, 185, 129, 0.5)' : stabilityData.stability.base >= 50 ? 'rgba(245, 158, 11, 0.5)' : 'rgba(239, 68, 68, 0.5)'})`
                    }}
                  />
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span 
                    className="text-2xl font-bold"
                    style={{ color: stabilityData.stability.base >= 70 ? '#10b981' : stabilityData.stability.base >= 50 ? '#f59e0b' : '#ef4444' }}
                  >
                    ~{stabilityData.stability.min}-{stabilityData.stability.max}%
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="flex-1">
                <h4 className="text-white font-semibold mb-2">Индекс на стабилност</h4>
                <p style={{ color: '#64748b' }} className="text-sm mb-3">
                  Показва колко стабилни са нивата между инжекциите.
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color: '#64748b' }}>Флуктуация:</span>
                    <span style={{ color: '#94a3b8' }}>~{stabilityData.fluctuation.min}-{stabilityData.fluctuation.max}%</span>
                  </div>
                  <div style={{ color: '#475569' }} className="text-xs mt-2">
                    Базирано на средни фармакокинетични данни
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleProtocolSubmit}
            style={{ background: 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
            className="w-full py-4 text-white font-bold text-lg rounded-xl transition-all duration-300 shadow-lg"
          >
            Запази протокол →
          </button>

          {/* Dev Reset */}
          <button
            onClick={resetApp}
            style={{ color: '#334155' }}
            className="w-full py-2 text-xs hover:text-red-400 transition-colors"
          >
            🔄 Reset App (dev)
          </button>

        </div>

        {/* Change Confirmation Modal */}
        {showChangeModal && (
          <div 
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="w-full max-w-md border rounded-2xl p-6 shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-white text-xl font-bold">Промяна в протокола</h3>
              </div>

              {/* Changes list */}
              <div 
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="border rounded-xl p-4 mb-4"
              >
                <p style={{ color: '#64748b' }} className="text-sm mb-3">Засечени промени:</p>
                <div className="space-y-2">
                  {detectedChanges.map((change, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span style={{ color: '#f87171' }}>•</span>
                      <span style={{ color: '#94a3b8' }}>{change.field}:</span>
                      <span style={{ color: '#f87171' }} className="line-through">{change.from}</span>
                      <span style={{ color: '#64748b' }}>→</span>
                      <span style={{ color: '#34d399' }}>{change.to}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reason input */}
              <div className="mb-4">
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                  Причина за промяната <span style={{ color: '#f87171' }}>*</span>
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Напр: Кръвни резултати показаха ниски нива..."
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none resize-none"
                  rows={3}
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={cancelProtocolChange}
                  style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}
                  className="flex-1 py-3 rounded-xl font-semibold hover:bg-slate-700 transition-colors"
                >
                  Отказ
                </button>
                <button
                  onClick={() => saveProtocol(changeReason)}
                  disabled={!changeReason.trim()}
                  style={{ 
                    background: changeReason.trim() 
                      ? 'linear-gradient(90deg, #06b6d4, #14b8a6)' 
                      : '#334155',
                    color: changeReason.trim() ? 'white' : '#64748b'
                  }}
                  className="flex-1 py-3 rounded-xl font-semibold transition-colors"
                >
                  Потвърди
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  // ============ AUTH LOADING ============
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a1628' }}>
        <div className="text-center">
          <div className="text-4xl font-bold mb-4" style={{ color: '#22d3ee' }}>THUB</div>
          <p style={{ color: '#64748b' }}>Зареждане...</p>
        </div>
      </div>
    );
  }

  // ============ NOT LOGGED IN ============
  if (!session) {
    // Show onboarding with login
    // The existing onboarding flow will handle this
  }

  // ============ MAIN APP ============
  
  // Compounds & Frequencies (same as protocol setup)
  const compounds = [
    { id: 'test_c_200', name: 'Testosterone Cypionate 200mg/mL', shortName: 'Test Cypionate 200', concentration: 200, unit: 'mg' },
    { id: 'test_e_200', name: 'Testosterone Enanthate 200mg/mL', shortName: 'Test Enanthate 200', concentration: 200, unit: 'mg' },
    { id: 'test_e_250', name: 'Testosterone Enanthate 250mg/mL', shortName: 'Test Enanthate 250', concentration: 250, unit: 'mg' },
    { id: 'test_c_250', name: 'Testosterone Cypionate 250mg/mL', shortName: 'Test Cypionate 250', concentration: 250, unit: 'mg' },
    { id: 'test_p_100', name: 'Testosterone Propionate 100mg/mL', shortName: 'Test Propionate 100', concentration: 100, unit: 'mg' },
    { id: 'hcg', name: 'HCG 5000IU / 5mL', shortName: 'HCG', concentration: 1000, unit: 'IU' },
  ];

  const frequenciesData = [
    { id: 'ED', name: 'Всеки ден', shortName: 'ED', perWeek: 7, periodDays: 7 },
    { id: 'EOD', name: 'През ден', shortName: 'EOD', perWeek: 3.5, periodDays: 14 },
    { id: '3xW', name: '3× седмично', shortName: '3xW', perWeek: 3, periodDays: 7 },
    { id: '2xW', name: '2× седмично', shortName: '2xW', perWeek: 2, periodDays: 7 },
  ];

  const monthNames = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  // Get protocol from profile - with safety defaults
  const proto = profile.protocol || protocolData;
  
  // Safety check - ensure all required fields exist
  if (!proto || !proto.compound || !proto.frequency || !proto.weeklyDose) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#0a1628' }}>
        <div className="text-center">
          <p className="text-white text-xl mb-4">Зареждане...</p>
          <p style={{ color: '#64748b' }}>Моля изчакайте</p>
        </div>
      </div>
    );
  }
  
  const compound = compounds.find(c => c.id === proto.compound) || compounds[0];
  const freq = frequenciesData.find(f => f.id === proto.frequency) || frequenciesData[1];

  // Calculations
  const dosePerInjection = proto.weeklyDose / freq.perWeek;
  const mlPerInjection = dosePerInjection / compound.concentration;
  const unitsRaw = mlPerInjection * 100;
  const unitsRounded = Math.round(unitsRaw / proto.graduation) * proto.graduation;
  const actualMl = unitsRounded / 100;
  const actualDose = actualMl * compound.concentration;
  const actualWeekly = actualDose * freq.perWeek;
  const deltaAbs = actualWeekly - proto.weeklyDose;
  const deltaPct = proto.weeklyDose > 0 ? deltaAbs / proto.weeklyDose : 0;

  // Get PK parameters for main view
  const pkParamsMain = getPkParameters(
    proto.compound,
    proto.injectionMethod || 'im',
    proto.oilType || 'unknown',
    proto.injectionLocation || 'delt',
    actualMl
  );

  // Calculate stability with range for main view
  const stabilityDataMain = calculateStabilityWithRange(pkParamsMain, actualDose, proto.frequency);

  // Generate PK data for graph with band
  const pkDataMain = generatePkData(pkParamsMain, actualDose, proto.frequency, 42, true);

  // Calculate "NOW" - REAL concentration based on logged injections
  const calculateCurrentStatus = () => {
    // Find all injections with time
    const sortedInjections = Object.entries(injections)
      .filter(([key, val]) => val && val.time)
      .map(([key, val]) => {
        const [year, month, day] = key.split('-').map(Number);
        const [hours, minutes] = val.time.split(':').map(Number);
        const date = new Date(year, month, day, hours, minutes);
        return { key, date, ...val };
      })
      .sort((a, b) => a.date - b.date); // oldest first

    if (sortedInjections.length === 0) return null;

    const now = new Date();
    const lastInjection = sortedInjections[sortedInjections.length - 1];
    const hoursSinceLastInjection = (now - lastInjection.date) / (1000 * 60 * 60);

    // PK parameters
    const halfLife = pkParamsMain.halfLife.base;
    const tmax = pkParamsMain.tmax.base;
    const bio = pkParamsMain.bioavailability;
    const ka = Math.log(2) / (tmax / 3);
    const ke = Math.log(2) / halfLife;

    // Calculate REAL current concentration from ALL logged injections
    let currentConcentration = 0;
    for (const inj of sortedInjections) {
      const hoursSince = (now - inj.date) / (1000 * 60 * 60);
      const daysSince = hoursSince / 24;
      
      if (daysSince >= 0 && daysSince < 30) {
        const d = actualDose * bio;
        const c = d * (ka / (ka - ke)) * (Math.exp(-ke * daysSince) - Math.exp(-ka * daysSince));
        currentConcentration += Math.max(0, c);
      }
    }

    // Calculate THEORETICAL steady state peak
    const injectionInterval = proto.frequency === 'ED' ? 1 : 
                              proto.frequency === 'EOD' ? 2 : 
                              proto.frequency === '3xW' ? 7/3 : 3.5;
    
    let steadyStatePeak = 0;
    for (let checkDay = 28; checkDay <= 42; checkDay += 0.1) {
      let conc = 0;
      for (let injNum = 0; injNum <= Math.floor(checkDay / injectionInterval); injNum++) {
        const injDay = injNum * injectionInterval;
        const timeSinceInj = checkDay - injDay;
        if (timeSinceInj >= 0 && timeSinceInj < 30) {
          const d = actualDose * bio;
          const c = d * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
          conc += Math.max(0, c);
        }
      }
      if (conc > steadyStatePeak) steadyStatePeak = conc;
    }

    // Percentage of steady state
    const currentPercent = steadyStatePeak > 0 ? 
      Math.round((currentConcentration / steadyStatePeak) * 100) : 0;

    // Days on protocol
    const firstInjection = sortedInjections[0];
    const daysOnProtocol = Math.round((now - firstInjection.date) / (1000 * 60 * 60 * 24));

    // Hours to next peak
    const hoursToNextPeak = Math.max(0, (tmax * 24) - hoursSinceLastInjection);

    return {
      lastInjection,
      hoursSinceLastInjection: Math.round(hoursSinceLastInjection * 10) / 10,
      currentPercent: Math.min(currentPercent, 105),
      daysOnProtocol,
      totalInjections: sortedInjections.length,
      hoursToNextPeak: Math.round(hoursToNextPeak * 10) / 10,
    };
  };

  // Auto-refresh: ticker changes every minute, triggering re-render and new Date()
  const currentStatus = calculateCurrentStatus();

  // Rotation schedule (ОПГ)
  const injectionsPerPeriod = proto.frequency === 'EOD' ? 7 : freq.perWeek;
  const targetPerPeriod = proto.frequency === 'EOD' ? proto.weeklyDose * 2 : proto.weeklyDose;

  const calculateRotation = () => {
    const lower = Math.floor(unitsRaw / proto.graduation) * proto.graduation;
    const higher = lower + proto.graduation;
    
    if (lower <= 0 || higher > 100) return null;
    
    const lowerMl = lower / 100;
    const higherMl = higher / 100;
    const lowerDose = lowerMl * compound.concentration;
    const higherDose = higherMl * compound.concentration;
    
    let bestCombo = null;
    let bestDelta = Infinity;
    
    for (let higherCount = 0; higherCount <= injectionsPerPeriod; higherCount++) {
      const lowerCount = injectionsPerPeriod - higherCount;
      const totalMg = (lowerCount * lowerDose) + (higherCount * higherDose);
      const delta = Math.abs(totalMg - targetPerPeriod);
      
      if (delta < bestDelta) {
        bestDelta = delta;
        bestCombo = { lowerCount, higherCount, lowerUnits: lower, higherUnits: higher, totalMg, delta: totalMg - targetPerPeriod };
      }
    }
    
    if (bestCombo && bestCombo.lowerCount > 0 && bestCombo.higherCount > 0) {
      bestCombo.deltaPct = targetPerPeriod > 0 ? bestCombo.delta / targetPerPeriod : 0;
      return bestCombo;
    }
    return null;
  };

  const rotation = calculateRotation();

  // Today's date
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Check if today is injection day
  const isInjectionDay = (date) => {
    const dayOfWeek = date.getDay();
    const startDate = new Date(proto.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));

    if (proto.frequency === 'ED') return true;
    if (proto.frequency === 'EOD') return daysDiff >= 0 ? daysDiff % 2 === 0 : Math.abs(daysDiff) % 2 === 0;
    if (proto.frequency === '2xW') return dayOfWeek === 1 || dayOfWeek === 4;
    if (proto.frequency === '3xW') return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    return false;
  };

  const todayIsInjectionDay = isInjectionDay(today);

  const todayCompleted = !!injections[todayKey];

  // Check for missed injections in the last 7 days
  const hasMissedInjection = () => {
    const startDate = new Date(proto.startDate);
    startDate.setHours(0, 0, 0, 0);
    
    for (let i = 1; i <= 7; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      checkDate.setHours(0, 0, 0, 0);
      
      // Don't check before protocol start
      if (checkDate < startDate) continue;
      
      if (isInjectionDay(checkDate)) {
        const dateKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
        if (!injections[dateKey]) {
          return true; // Found a missed injection
        }
      }
    }
    return false;
  };

  const missedInjection = hasMissedInjection();

  const toggleTodayInjection = () => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    setInjections(prev => {
      if (prev[todayKey]) {
        const newState = { ...prev };
        delete newState[todayKey];
        return newState;
      }
      return { ...prev, [todayKey]: { time: timeStr, dose: unitsRounded, location: selectedLocation, side: selectedSide } };
    });
  };

  // Get dose for specific date (for rotation)
  const getDoseForDate = (date) => {
    if (!isInjectionDay(date)) return null;
    if (!rotation) return unitsRounded;

    const startDate = new Date(proto.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));
    const dayOfWeek = date.getDay();

    let injectionIndex = 0;
    if (proto.frequency === 'ED') {
      injectionIndex = ((daysDiff % 7) + 7) % 7;
    } else if (proto.frequency === 'EOD') {
      const injectionNumber = Math.floor(daysDiff / 2);
      injectionIndex = ((injectionNumber % 7) + 7) % 7;
    } else if (proto.frequency === '2xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : 1;
      injectionIndex = (weekNumber * 2 + positionInWeek) % 2;
    } else if (proto.frequency === '3xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : dayOfWeek === 3 ? 1 : 2;
      injectionIndex = (weekNumber * 3 + positionInWeek) % 3;
    }

    // Build rotation schedule
    const schedule = [];
    let higherUsed = 0;
    for (let i = 0; i < injectionsPerPeriod; i++) {
      const expectedHigher = Math.round((i + 1) * rotation.higherCount / injectionsPerPeriod);
      if (higherUsed < expectedHigher) {
        schedule.push(rotation.higherUnits);
        higherUsed++;
      } else {
        schedule.push(rotation.lowerUnits);
      }
    }

    return schedule[injectionIndex % schedule.length];
  };

  const todayDose = getDoseForDate(today) || unitsRounded;

  // ============ CALENDAR HANDLERS ============
  const handleDayClick = (date, isInjDay, hasInjection) => {
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    setSelectedDate({ date, dateKey });

    if (isInjDay && hasInjection) {
      // Show details modal for existing injection
      setShowInjectionModal(true);
    } else if (isInjDay && !hasInjection) {
      // Show add form for planned injection day
      const defaultDose = getDoseForDate(date) || unitsRounded;
      setInjectionFormData({
        time: '09:00',
        dose: defaultDose,
        location: proto.injectionLocation || 'delt',
        side: 'left'
      });
      setShowAddInjectionModal(true);
    } else {
      // Show warning for non-injection day
      setShowWarningModal(true);
    }
  };

  const handleAddInjection = () => {
    if (!selectedDate) return;
    
    setInjections(prev => ({
      ...prev,
      [selectedDate.dateKey]: {
        time: injectionFormData.time,
        dose: injectionFormData.dose,
        location: injectionFormData.location,
        side: injectionFormData.side
      }
    }));
    
    setShowAddInjectionModal(false);
    setShowWarningModal(false);
    setSelectedDate(null);
  };

  const handleEditInjection = () => {
    if (!selectedDate) return;
    
    const existing = injections[selectedDate.dateKey];
    setInjectionFormData({
      time: existing.time || '09:00',
      dose: existing.dose || unitsRounded,
      location: existing.location || 'delt',
      side: existing.side || 'left'
    });
    
    setShowInjectionModal(false);
    setShowAddInjectionModal(true);
  };

  const handleDeleteInjection = () => {
    if (!selectedDate) return;
    if (!window.confirm('Сигурен ли си че искаш да изтриеш тази инжекция?')) return;
    
    setInjections(prev => {
      const newState = { ...prev };
      delete newState[selectedDate.dateKey];
      return newState;
    });
    
    setShowInjectionModal(false);
    setSelectedDate(null);
  };

  const closeAllModals = () => {
    setShowInjectionModal(false);
    setShowAddInjectionModal(false);
    setShowWarningModal(false);
    setSelectedDate(null);
  };

  // ============ SYRINGE COMPONENT ============

  // Syringe component for main view - with logo inside
  const SyringeMain = ({ units }) => {
    const maxUnits = proto.graduation === 1 ? 50 : 100;
    const displayUnits = Math.min(units, maxUnits);
    const ticks = proto.graduation === 2
      ? Array.from({ length: 51 }, (_, i) => i * 2)
      : Array.from({ length: 51 }, (_, i) => i);

    return (
      <div className="relative">
        <div 
          style={{ backgroundColor: '#0f172a', borderColor: '#334155', width: '110px', height: '450px' }}
          className="relative border-2 rounded-xl overflow-hidden"
        >
          {/* Logo at top inside syringe */}
          <div className="absolute top-0 left-0 right-0 z-10 py-3 text-center" style={{ backgroundColor: '#0f172a' }}>
            <span className="text-white text-sm font-black tracking-wide">THUB</span>
          </div>

          {ticks.map(tick => {
            const pos = 12 + ((maxUnits - tick) / maxUnits) * 84;
            const isMajor = tick % 10 === 0;
            const isMedium = tick % 5 === 0 && !isMajor;

            return (
              <div 
                key={tick} 
                className="absolute w-full left-0 right-0"
                style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
              >
                <div className="flex items-center justify-between px-1">
                  <div 
                    style={{ 
                      backgroundColor: isMajor ? '#f1f5f9' : isMedium ? '#94a3b8' : '#64748b',
                      width: isMajor ? '18px' : isMedium ? '12px' : '7px',
                      height: isMajor ? '3px' : isMedium ? '2px' : '1px'
                    }}
                  />
                  {isMajor && (
                    <span style={{ color: '#f1f5f9', fontSize: '12px' }} className="font-bold">{tick}</span>
                  )}
                  <div 
                    style={{ 
                      backgroundColor: isMajor ? '#f1f5f9' : isMedium ? '#94a3b8' : '#64748b',
                      width: isMajor ? '18px' : isMedium ? '12px' : '7px',
                      height: isMajor ? '3px' : isMedium ? '2px' : '1px'
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* Liquid fill */}
          <div 
            style={{ 
              background: todayCompleted 
                ? 'linear-gradient(to top, #059669, #10b981, #34d399)' 
                : 'linear-gradient(to top, #0891b2, #06b6d4, #22d3ee)',
              height: `${4 + (displayUnits / maxUnits) * 84}%`,
              opacity: 0.5
            }}
            className="absolute bottom-0 left-0 right-0 transition-all duration-500 rounded-b-lg"
          />
        </div>
        <div style={{ color: '#64748b' }} className="text-center text-xs mt-2">
          {actualMl.toFixed(2)} mL
        </div>
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="pb-24">

      {/* Content */}
      <main className="p-4 pt-6">
        
        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div className="space-y-4">

            {todayIsInjectionDay ? (
              <>
                {/* Main Card - Syringe + Dose */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-6 relative"
                >
                  {/* Date badge top right */}
                  <div className="absolute top-3 right-3">
                    <span 
                      style={{ color: '#22d3ee', backgroundColor: '#0a1628', borderColor: '#0891b2' }} 
                      className="text-sm font-semibold px-3 py-1 rounded-full border"
                    >
                      {dayNames[today.getDay()]} {today.getDate().toString().padStart(2, '0')}/{(today.getMonth() + 1).toString().padStart(2, '0')}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-8 mt-4">
                    <SyringeMain units={todayDose} />
                    
                    <div className="text-center">
                      <p style={{ color: '#64748b' }} className="text-sm mb-1">Дръпни до</p>
                      <p 
                        style={{ color: todayCompleted ? '#34d399' : '#22d3ee' }} 
                        className="text-6xl font-bold"
                      >
                        {todayDose}U
                      </p>
                      <div style={{ color: '#64748b' }} className="text-sm mt-2 space-y-1">
                        <p>{actualDose.toFixed(1)} {compound.unit}</p>
                        <p>{actualMl.toFixed(2)} mL</p>
                      </div>
                    </div>
                  </div>

                  {/* Location Picker */}
                  <div className="mt-4">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: 'glute', label: 'Глутеус', emoji: '🍑' },
                        { id: 'delt', label: 'Делтоид', emoji: '💪' },
                        { id: 'quad', label: 'Бедро', emoji: '🦵' },
                        { id: 'abdomen', label: 'Корем', emoji: '⭕' }
                      ].map(loc => (
                        <button
                          key={loc.id}
                          onClick={() => {
                            if (!todayCompleted) {
                              setPendingLocation(loc);
                              setShowLocationModal(true);
                            }
                          }}
                          disabled={todayCompleted}
                          style={{ 
                            backgroundColor: selectedLocation === loc.id ? '#0891b2' : '#0a1628',
                            borderColor: selectedLocation === loc.id ? '#0891b2' : '#1e3a5f',
                            color: 'white',
                            opacity: todayCompleted ? 0.5 : 1
                          }}
                          className="py-3 border rounded-xl font-medium transition-colors text-sm flex items-center justify-center"
                        >
                          <span>{loc.label}</span>
                          {selectedLocation === loc.id && selectedSide && (
                            <span style={{ color: '#22d3ee' }} className="ml-1">
                              {selectedSide === 'left' ? 'Л' : 'Д'}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Location Side Modal */}
                  {showLocationModal && pendingLocation && (
                    <div 
                      style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
                      className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    >
                      <div 
                        style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                        className="w-full max-w-sm border rounded-2xl p-6 shadow-2xl"
                      >
                        <div className="text-center mb-6">
                          <span className="text-4xl">{pendingLocation.emoji}</span>
                          <h3 className="text-white text-xl font-bold mt-2">{pendingLocation.label}</h3>
                        </div>

                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              setSelectedLocation(pendingLocation.id);
                              setSelectedSide('left');
                              setShowLocationModal(false);
                              setPendingLocation(null);
                            }}
                            style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                            className="flex-1 py-4 border rounded-xl font-semibold text-white hover:bg-cyan-900 transition-colors"
                          >
                            Ляво
                          </button>
                          <button
                            onClick={() => {
                              setSelectedLocation(pendingLocation.id);
                              setSelectedSide('right');
                              setShowLocationModal(false);
                              setPendingLocation(null);
                            }}
                            style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                            className="flex-1 py-4 border rounded-xl font-semibold text-white hover:bg-cyan-900 transition-colors"
                          >
                            Дясно
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            setShowLocationModal(false);
                            setPendingLocation(null);
                          }}
                          style={{ color: '#64748b' }}
                          className="w-full mt-4 py-2 text-sm hover:text-white transition-colors"
                        >
                          Отказ
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action Button */}
                  <button
                    onClick={toggleTodayInjection}
                    style={{ 
                      background: todayCompleted 
                        ? 'linear-gradient(90deg, #059669, #10b981)' 
                        : missedInjection 
                          ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                          : 'linear-gradient(90deg, #06b6d4, #14b8a6)' 
                    }}
                    className={`w-full mt-6 py-4 text-white font-semibold rounded-xl transition-all ${
                      !todayCompleted && missedInjection ? 'animate-pulse' : ''
                    }`}
                  >
                    {todayCompleted 
                      ? `✓ Направено ${injections[todayKey]?.time} ${
                          injections[todayKey]?.location === 'glute' ? '🍑' : 
                          injections[todayKey]?.location === 'delt' ? '💪' : 
                          injections[todayKey]?.location === 'quad' ? '🦵' : 
                          injections[todayKey]?.location === 'abdomen' ? '⭕' : ''
                        }${injections[todayKey]?.side === 'left' ? 'Л' : injections[todayKey]?.side === 'right' ? 'Д' : ''}`
                      : missedInjection 
                        ? '⚠️ Пропусната инжекция! Маркирай'
                        : '💉 Маркирай като направено'
                    }
                  </button>
                </div>

                {/* Оптимизация на протокола */}
                {(() => {
                  // EOD = 14 дни, останалите = 7 дни
                  const isEOD = proto.frequency === 'EOD';
                  const cycleDays = isEOD ? 14 : 7;
                  
                  const todayDayOfWeek = today.getDay(); // 0=Нд, 1=Пн...
                  
                  // Намираме понеделника на тази седмица
                  const mondayOfWeek = new Date(today);
                  const daysFromMonday = todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1;
                  mondayOfWeek.setDate(today.getDate() - daysFromMonday);
                  
                  // Имена на дните
                  const dayNamesShort = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
                  
                  // Генерираме дните за цикъла
                  const cycleData = [];
                  for (let i = 0; i < cycleDays; i++) {
                    const dayDate = new Date(mondayOfWeek);
                    dayDate.setDate(mondayOfWeek.getDate() + i);
                    
                    const dayKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
                    const isInjDay = isInjectionDay(dayDate);
                    const dose = isInjDay ? (getDoseForDate(dayDate) || unitsRounded) : 0;
                    const isCompleted = !!injections[dayKey];
                    const isToday = dayDate.toDateString() === today.toDateString();
                    const isFuture = dayDate > today;
                    const dayName = dayNamesShort[dayDate.getDay()];
                    
                    cycleData.push({ dayName, dayDate, dayKey, isInjDay, dose, isCompleted, isToday, isFuture });
                  }
                  
                  // Броим инжекции и дози за цикъла
                  const cycleInjections = cycleData.filter(d => d.isInjDay);
                  const cycleTotalMg = cycleInjections.reduce((sum, d) => sum + (d.dose / 100 * compound.concentration), 0);
                  const weeklyMg = isEOD ? cycleTotalMg / 2 : cycleTotalMg;
                  
                  // Групираме дозите за формулата
                  const doseCounts = {};
                  cycleInjections.forEach(d => {
                    doseCounts[d.dose] = (doseCounts[d.dose] || 0) + 1;
                  });
                  const doseFormula = Object.entries(doseCounts)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([dose, count]) => `${count}×${dose}U`)
                    .join(' + ');
                  
                  return (
                    <div 
                      style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                      className="border rounded-2xl p-4"
                    >
                      <p style={{ color: '#22d3ee' }} className="font-semibold mb-3 text-sm">
                        Оптимизация на протокола {isEOD ? '(14 дни)' : ''}
                      </p>
                      
                      <div className="overflow-x-auto pt-2 pb-2">
                        <div className="flex gap-2 min-w-max justify-center px-1">
                          {cycleData.map((day, i) => {
                            // Определяме цвета
                            let bgColor = '#0891b2'; // cyan - предстои
                            if (day.isCompleted) bgColor = '#059669'; // зелен - направено
                            
                            // Може ли да се кликне (само ако е инжекционен ден и не е бъдещ)
                            const canClick = day.isInjDay && !day.isFuture;
                            
                            return (
                              <button
                                key={i}
                                onClick={() => {
                                  if (!canClick) return;
                                  const timeStr = day.isToday 
                                    ? `${new Date().getHours().toString().padStart(2, '0')}:${new Date().getMinutes().toString().padStart(2, '0')}`
                                    : '12:00';
                                  setInjections(prev => {
                                    if (prev[day.dayKey]) {
                                      const newState = { ...prev };
                                      delete newState[day.dayKey];
                                      return newState;
                                    }
                                    return { ...prev, [day.dayKey]: { time: timeStr, dose: day.dose, location: selectedLocation, side: selectedSide } };
                                  });
                                }}
                                disabled={!canClick}
                                style={{ 
                                  backgroundColor: bgColor,
                                  minWidth: '40px',
                                  cursor: canClick ? 'pointer' : 'default',
                                  opacity: day.isFuture ? 0.6 : 1,
                                  animation: day.isToday ? 'pulse 2s infinite' : 'none',
                                  boxShadow: day.isToday ? '0 0 0 3px rgba(34, 211, 238, 0.5)' : 'none'
                                }}
                                className="px-2 py-2 rounded-lg text-center border-0"
                              >
                                <div style={{ color: 'white', fontSize: '10px', opacity: 0.8 }}>{day.dayName}</div>
                                <div style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>{day.dose}U</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* Формула */}
                      <p style={{ color: '#94a3b8' }} className="text-sm text-center mt-2">
                        {doseFormula} = {weeklyMg.toFixed(1)} {compound.unit}/сед
                      </p>
                    </div>
                  );
                })()}
                
                {/* CSS за pulse анимация */}
                <style>{`
                  @keyframes pulse {
                    0%, 100% { box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.5); }
                    50% { box-shadow: 0 0 0 6px rgba(34, 211, 238, 0.2); }
                  }
                `}</style>

                {/* Delta info (if no rotation) */}
                {!rotation && Math.abs(deltaPct) > 0.01 && (
                  <div 
                    style={{ backgroundColor: '#1c1917', borderColor: '#78350f' }}
                    className="border rounded-2xl p-4"
                  >
                    <p style={{ color: '#fbbf24' }} className="font-semibold mb-1">📊 Седмична делта</p>
                    <p style={{ color: '#d97706' }} className="text-sm">
                      {deltaAbs >= 0 ? '+' : ''}{deltaAbs.toFixed(1)} {compound.unit} ({(deltaPct * 100).toFixed(2)}%)
                    </p>
                  </div>
                )}

                {/* PK Graph - Normalized concentration (0-100%) with band */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-4"
                >
                  <p style={{ color: '#64748b' }} className="text-sm font-medium mb-3 text-center">
                    Относителна концентрация (6 седмици)
                  </p>
                  
                  {/* Current status indicator */}
                  {currentStatus && (
                    <div className="mb-3 p-2 rounded-lg" style={{ backgroundColor: '#1e293b' }}>
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                        <span style={{ color: '#fbbf24' }} className="text-sm font-medium">
                          Сега: ~{currentStatus.currentPercent}% от steady state
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-3 mt-1 text-xs" style={{ color: '#64748b' }}>
                        <span>{currentStatus.hoursSinceLastInjection}ч след инж.</span>
                        <span>•</span>
                        <span>Ден {currentStatus.daysOnProtocol}</span>
                        <span>•</span>
                        <span>{currentStatus.totalInjections} инж. логнати</span>
                        {currentStatus.hoursToNextPeak > 0 && currentStatus.hoursSinceLastInjection < 48 && (
                          <>
                            <span>•</span>
                            <span>Пик ~{currentStatus.hoursToNextPeak}ч</span>
                          </>
                        )}
                      </div>
                      {currentStatus.daysOnProtocol < 28 && (
                        <p className="text-xs text-center mt-1" style={{ color: '#f59e0b' }}>
                          ⚠️ Steady state след ~{28 - currentStatus.daysOnProtocol} дни
                        </p>
                      )}
                    </div>
                  )}
                  
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart 
                        data={pkDataMain}
                        margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="pkGradientToday" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="pkBandGradientToday" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="day" 
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          tickFormatter={(v) => `${Math.round(v)}д`}
                          axisLine={{ stroke: '#334155' }}
                          tickLine={{ stroke: '#334155' }}
                          interval={40}
                        />
                        <YAxis 
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          axisLine={{ stroke: '#334155' }}
                          tickLine={{ stroke: '#334155' }}
                          tickFormatter={(v) => `${v}%`}
                          domain={[0, 110]}
                          ticks={[0, 25, 50, 75, 100]}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px' }}
                          labelStyle={{ color: '#94a3b8' }}
                          itemStyle={{ color: '#22d3ee' }}
                          formatter={(value, name) => {
                            if (name === 'percent') return [`${Math.round(value)}% от пик`, 'Концентрация'];
                            return [null, null]; // Hide other series
                          }}
                          labelFormatter={(label) => `Ден ${Math.round(label * 10) / 10}`}
                        />
                        {/* Band area (min-max range) - hidden from legend/tooltip */}
                        <Area 
                          type="natural" 
                          dataKey="percentMax"
                          stroke="none"
                          fill="url(#pkBandGradientToday)"
                          legendType="none"
                        />
                        {/* Main line */}
                        <Area 
                          type="natural" 
                          dataKey="percent" 
                          stroke="#06b6d4" 
                          strokeWidth={2}
                          fill="url(#pkGradientToday)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <p style={{ color: '#475569' }} className="text-xs text-center mt-2">
                    t½ ~{pkParamsMain.halfLife.min.toFixed(1)}-{pkParamsMain.halfLife.max.toFixed(1)}д │ {pkParamsMain.modifiers.method}{pkParamsMain.modifiers.oil ? ` │ ${pkParamsMain.modifiers.oil}` : ''} │ Trough: ~{stabilityDataMain.troughPercent.min}-{stabilityDataMain.troughPercent.max}%
                  </p>
                </div>
              </>
            ) : (
              /* Rest Day */
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-8 text-center"
              >
                <p className="text-5xl mb-4">😌</p>
                <p className="text-white text-2xl font-bold">Почивен ден</p>
                <p style={{ color: '#64748b' }} className="mt-2">Следваща инжекция скоро</p>
              </div>
            )}
          </div>
        )}

        {/* CALENDAR TAB */}
        {activeTab === 'calendar' && (
          <>
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                style={{ color: '#64748b' }}
                className="p-2"
              >
                ←
              </button>
              <h3 className="text-white font-bold">
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h3>
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                style={{ color: '#64748b' }}
                className="p-2"
              >
                →
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map(d => (
                <div key={d} style={{ color: '#64748b' }} className="text-center text-xs py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth();
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells = [];

                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} />);
                }

                for (let day = 1; day <= daysInMonth; day++) {
                  const date = new Date(year, month, day);
                  const dateKey = `${year}-${month}-${day}`;
                  const isInj = isInjectionDay(date);
                  const done = !!injections[dateKey];
                  const doneTime = injections[dateKey]?.time;
                  const doneLocation = injections[dateKey]?.location;
                  const doneSide = injections[dateKey]?.side;
                  const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                  const dose = isInj ? getDoseForDate(date) : null;

                  const locationEmoji = doneLocation === 'glute' ? '🍑' : 
                                        doneLocation === 'delt' ? '💪' : 
                                        doneLocation === 'quad' ? '🦵' : 
                                        doneLocation === 'abdomen' ? '⭕' : '';
                  const sideLabel = doneSide === 'left' ? 'Л' : doneSide === 'right' ? 'Д' : '';

                  cells.push(
                    <div
                      key={day}
                      onClick={() => handleDayClick(date, isInj, done)}
                      style={{ 
                        backgroundColor: isInj ? (done ? '#059669' : '#0891b2') : '#1e293b',
                        borderColor: isToday ? '#22d3ee' : 'transparent',
                        cursor: 'pointer'
                      }}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs border-2 hover:opacity-80 transition-opacity`}
                    >
                      <span className="text-white font-semibold">{day}</span>
                      {isInj && <span style={{ color: done ? '#d1fae5' : '#cffafe' }} className="text-xs">{dose}U</span>}
                      {done && locationEmoji && <span style={{ fontSize: '10px' }}>{locationEmoji}{sideLabel}</span>}
                    </div>
                  );
                }

                return cells;
              })()}
            </div>
          </div>

          {/* Последни инжекции */}
          {Object.keys(injections).length > 0 && (
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4 mt-4"
            >
              <h4 style={{ color: '#64748b' }} className="text-sm font-medium mb-3">Последни инжекции</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(injections)
                  .sort((a, b) => {
                    const [aYear, aMonth, aDay] = a[0].split('-').map(Number);
                    const [bYear, bMonth, bDay] = b[0].split('-').map(Number);
                    return new Date(bYear, bMonth, bDay) - new Date(aYear, aMonth, aDay);
                  })
                  .slice(0, 10)
                  .map(([dateKey, data]) => {
                    const [year, month, day] = dateKey.split('-').map(Number);
                    const emoji = data.location === 'glute' ? '🍑' : 
                                  data.location === 'delt' ? '💪' : 
                                  data.location === 'quad' ? '🦵' : 
                                  data.location === 'abdomen' ? '⭕' : '💉';
                    const side = data.side === 'left' ? 'Л' : data.side === 'right' ? 'Д' : '';
                    return (
                      <div 
                        key={dateKey}
                        style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                        className="border rounded-lg px-3 py-2 flex items-center gap-2"
                      >
                        <span className="text-sm">{emoji}{side}</span>
                        <span style={{ color: '#64748b' }} className="text-xs">{day}.{month + 1}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ============ INJECTION DETAILS MODAL ============ */}
          {showInjectionModal && selectedDate && injections[selectedDate.dateKey] && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
              onClick={closeAllModals}
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border-2 rounded-2xl p-6 max-w-md w-full"
              >
                <h3 className="text-white text-xl font-bold mb-4">
                  Инжекция {selectedDate.date.getDate()}.{selectedDate.date.getMonth() + 1}.{selectedDate.date.getFullYear()}
                </h3>
                
                {(() => {
                  const inj = injections[selectedDate.dateKey];
                  const locationName = inj.location === 'glute' ? '🍑 Глутеус' :
                                      inj.location === 'delt' ? '💪 Дълтовид' :
                                      inj.location === 'quad' ? '🦵 Квадрицепс' :
                                      inj.location === 'abdomen' ? '⭕ Коремна област' : 'Неизвестно';
                  const sideName = inj.side === 'left' ? 'Ляво' : inj.side === 'right' ? 'Дясно' : '';
                  
                  return (
                    <div className="space-y-3 mb-6">
                      <div className="flex justify-between">
                        <span style={{ color: '#64748b' }}>Час:</span>
                        <span className="text-white font-semibold">{inj.time}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: '#64748b' }}>Доза:</span>
                        <span style={{ color: '#22d3ee' }} className="font-bold">{inj.dose}U</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: '#64748b' }}>Локация:</span>
                        <span className="text-white">{locationName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: '#64748b' }}>Страна:</span>
                        <span className="text-white">{sideName}</span>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteInjection}
                    style={{ backgroundColor: '#7f1d1d' }}
                    className="flex-1 py-3 rounded-xl text-white font-semibold hover:bg-red-900 transition-colors"
                  >
                    🗑️ Изтрий
                  </button>
                  <button
                    onClick={handleEditInjection}
                    style={{ backgroundColor: '#1e3a5f' }}
                    className="flex-1 py-3 rounded-xl text-white font-semibold hover:bg-slate-700 transition-colors"
                  >
                    ✏️ Редактирай
                  </button>
                  <button
                    onClick={closeAllModals}
                    style={{ backgroundColor: '#334155' }}
                    className="flex-1 py-3 rounded-xl text-white font-semibold hover:bg-slate-600 transition-colors"
                  >
                    Затвори
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============ ADD/EDIT INJECTION MODAL ============ */}
          {showAddInjectionModal && selectedDate && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
              onClick={closeAllModals}
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border-2 rounded-2xl p-6 max-w-md w-full"
              >
                <h3 className="text-white text-xl font-bold mb-4">
                  Добави инжекция
                </h3>
                <p style={{ color: '#64748b' }} className="text-sm mb-4">
                  {selectedDate.date.getDate()}.{selectedDate.date.getMonth() + 1}.{selectedDate.date.getFullYear()}
                </p>

                <div className="space-y-4 mb-6">
                  {/* Time */}
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm mb-2">Час</label>
                    <input
                      type="time"
                      value={injectionFormData.time}
                      onChange={(e) => setInjectionFormData(prev => ({ ...prev, time: e.target.value }))}
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="w-full p-3 border rounded-xl text-white"
                    />
                  </div>

                  {/* Dose */}
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm mb-2">Доза (Units)</label>
                    <input
                      type="number"
                      value={injectionFormData.dose}
                      onChange={(e) => setInjectionFormData(prev => ({ ...prev, dose: parseFloat(e.target.value) || 0 }))}
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="w-full p-3 border rounded-xl text-white"
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm mb-2">Локация</label>
                    <select
                      value={injectionFormData.location}
                      onChange={(e) => setInjectionFormData(prev => ({ ...prev, location: e.target.value }))}
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="w-full p-3 border rounded-xl text-white"
                    >
                      <option value="glute">🍑 Глутеус</option>
                      <option value="delt">💪 Дълтовид</option>
                      <option value="quad">🦵 Квадрицепс</option>
                      <option value="abdomen">⭕ Коремна област</option>
                    </select>
                  </div>

                  {/* Side */}
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm mb-2">Страна</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setInjectionFormData(prev => ({ ...prev, side: 'left' }))}
                        style={{
                          backgroundColor: injectionFormData.side === 'left' ? '#1e3a5f' : '#0a1628',
                          borderColor: injectionFormData.side === 'left' ? '#22d3ee' : '#1e3a5f',
                          color: injectionFormData.side === 'left' ? '#22d3ee' : '#64748b'
                        }}
                        className="flex-1 p-3 border-2 rounded-xl font-semibold transition-colors"
                      >
                        Ляво
                      </button>
                      <button
                        onClick={() => setInjectionFormData(prev => ({ ...prev, side: 'right' }))}
                        style={{
                          backgroundColor: injectionFormData.side === 'right' ? '#1e3a5f' : '#0a1628',
                          borderColor: injectionFormData.side === 'right' ? '#22d3ee' : '#1e3a5f',
                          color: injectionFormData.side === 'right' ? '#22d3ee' : '#64748b'
                        }}
                        className="flex-1 p-3 border-2 rounded-xl font-semibold transition-colors"
                      >
                        Дясно
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={closeAllModals}
                    style={{ backgroundColor: '#334155' }}
                    className="flex-1 py-3 rounded-xl text-white font-semibold hover:bg-slate-600 transition-colors"
                  >
                    Отказ
                  </button>
                  <button
                    onClick={handleAddInjection}
                    style={{ background: 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
                    className="flex-1 py-3 rounded-xl text-white font-bold hover:opacity-90 transition-opacity"
                  >
                    ✅ Запази
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============ WARNING MODAL (non-injection day) ============ */}
          {showWarningModal && selectedDate && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
              onClick={closeAllModals}
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                style={{ backgroundColor: '#0f172a', borderColor: '#f59e0b' }}
                className="border-2 rounded-2xl p-6 max-w-md w-full"
              >
                <div className="text-center mb-4">
                  <span className="text-5xl">⚠️</span>
                </div>
                <h3 className="text-white text-xl font-bold mb-2 text-center">
                  Внимание
                </h3>
                <p style={{ color: '#f59e0b' }} className="text-center mb-4">
                  {selectedDate.date.getDate()}.{selectedDate.date.getMonth() + 1}.{selectedDate.date.getFullYear()} не е планиран injection day според твоя протокол
                </p>
                <p style={{ color: '#64748b' }} className="text-sm text-center mb-6">
                  Сигурен ли си че искаш да добавиш инжекция в този ден?
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={closeAllModals}
                    style={{ backgroundColor: '#334155' }}
                    className="flex-1 py-3 rounded-xl text-white font-semibold hover:bg-slate-600 transition-colors"
                  >
                    Отказ
                  </button>
                  <button
                    onClick={() => {
                      const defaultDose = getDoseForDate(selectedDate.date) || unitsRounded;
                      setInjectionFormData({
                        time: '09:00',
                        dose: defaultDose,
                        location: proto.injectionLocation || 'delt',
                        side: 'left'
                      });
                      setShowWarningModal(false);
                      setShowAddInjectionModal(true);
                    }}
                    style={{ background: 'linear-gradient(90deg, #f59e0b, #f97316)' }}
                    className="flex-1 py-3 rounded-xl text-white font-bold hover:opacity-90 transition-opacity"
                  >
                    ✅ Добави инжекция
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-white font-bold">Текущ протокол</h3>
                <button 
                  onClick={() => setCurrentStep('protocol')}
                  style={{ 
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderColor: '#0891b2',
                    color: '#22d3ee',
                    boxShadow: '0 0 10px rgba(6, 182, 212, 0.15)'
                  }}
                  className="px-3 py-1.5 border rounded-lg text-sm hover:bg-cyan-500/20 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all duration-300"
                >
                  Редактирай
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Име</span>
                  <span className="text-white">{profile.name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Препарат</span>
                  <span className="text-white">{compound.shortName || compound.name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Седмична доза</span>
                  <span className="text-white">{proto.weeklyDose} {compound.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Честота</span>
                  <span className="text-white">{freq.name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Доза/инжекция</span>
                  <span style={{ color: '#22d3ee' }} className="font-bold">{unitsRaw.toFixed(1)}U ({dosePerInjection.toFixed(1)} {compound.unit})</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Скала</span>
                  <span className="text-white">{proto.graduation}U (0-{proto.graduation === 1 ? 50 : 100}U)</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Начало на протокола</span>
                  <span style={{ color: '#22d3ee' }}>{new Date(proto.startDate).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Източник</span>
                  <span className="text-white">{proto.source === 'pharmacy' ? '🏥 Аптека' : proto.source === 'ugl' ? '🧪 UGL' : '❓ Не знам'}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Масло</span>
                  <span className="text-white">
                    {proto.oilType === 'mct' ? 'MCT' : 
                     proto.oilType === 'grape_seed' ? 'Grape Seed' : 
                     proto.oilType === 'sesame' ? 'Sesame' : 
                     proto.oilType === 'castor' ? 'Castor' : 
                     proto.oilType === 'other' ? 'Друго' : 'Не знам'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Метод</span>
                  <span className="text-white">{proto.injectionMethod === 'im' ? '💉 IM' : '💧 SubQ'}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4 text-center"
              >
                <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">{Object.keys(injections).length}</p>
                <p style={{ color: '#64748b' }} className="text-sm">Инжекции</p>
              </div>
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4 text-center"
              >
                <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">
                  {Math.floor((new Date() - new Date(proto.startDate)) / (1000 * 60 * 60 * 24 * 7))}
                </p>
                <p style={{ color: '#64748b' }} className="text-sm">Седмици</p>
              </div>
            </div>

            {/* Protocol History */}
            {profile.protocolHistory && profile.protocolHistory.length > 0 && (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4"
              >
                <h3 className="text-white font-bold mb-4">📋 История на промените</h3>
                <div className="space-y-3">
                  {profile.protocolHistory.slice().reverse().map((entry, i) => (
                    <div 
                      key={i}
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="border rounded-xl p-3"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span style={{ color: '#22d3ee' }} className="text-sm font-semibold">
                          {new Date(entry.date).toLocaleDateString('bg-BG', { 
                            day: 'numeric', 
                            month: 'short', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <p style={{ color: '#f87171' }} className="text-sm mb-1">
                        {entry.changes}
                      </p>
                      <p style={{ color: '#94a3b8' }} className="text-sm italic">
                        "{entry.reason}"
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* JOURNAL TAB */}
        {activeTab === 'journal' && (
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-8 text-center"
          >
            <p className="text-4xl mb-4">📝</p>
            <p className="text-white font-bold">Журнал</p>
            <p style={{ color: '#64748b' }} className="text-sm mt-2">Скоро...</p>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <h3 className="text-white font-bold mb-4">Профил</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Име</span>
                  <span className="text-white">{profile.name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Имейл</span>
                  <span className="text-white">{profile.email}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setCurrentStep('protocol')}
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="w-full border rounded-2xl p-4 text-left flex items-center justify-between"
            >
              <span className="text-white">Редактирай протокол</span>
              <span style={{ color: '#64748b' }}>→</span>
            </button>

            <button
              onClick={handleSignOut}
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="w-full border rounded-2xl p-4 text-left flex items-center justify-between"
            >
              <span className="text-white">🚪 Изход</span>
              <span style={{ color: '#64748b' }}>→</span>
            </button>

            <button
              onClick={resetApp}
              style={{ borderColor: '#7f1d1d' }}
              className="w-full border rounded-2xl p-4 text-red-400 text-center"
            >
              🔄 Reset App (изтрива всичко)
            </button>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav 
        style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
        className="fixed bottom-0 left-0 right-0 border-t px-2 py-2 flex justify-around"
      >
        {[
          { id: 'today', icon: '🏠', label: 'Днес' },
          { id: 'calendar', icon: '📅', label: 'Календар' },
          { id: 'stats', icon: '📊', label: 'Статистика' },
          { id: 'journal', icon: '📝', label: 'Журнал' },
          { id: 'settings', icon: '⚙️', label: 'Настройки' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex flex-col items-center py-2 px-3 rounded-xl transition-all"
            style={{ 
              backgroundColor: activeTab === tab.id ? '#1e3a5f' : 'transparent',
              color: activeTab === tab.id ? '#22d3ee' : '#64748b'
            }}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="text-xs mt-1">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default THUBApp;
