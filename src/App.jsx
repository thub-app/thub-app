import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

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

  // ============ STATE ============
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

  // Modal state за потвърждение на промени
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [detectedChanges, setDetectedChanges] = useState([]);
  const [changeReason, setChangeReason] = useState('');

  // Save injections when changed
  useEffect(() => {
    saveToStorage('thub-injections', injections);
  }, [injections]);

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
  const handleOnboardingSubmit = () => {
    if (authMode === 'signup') {
      // SIGN UP - create new profile
      if (validateOnboarding()) {
        const newProfile = {
          ...profile,
          name: formData.name.trim(),
          email: formData.email.trim(),
          password: formData.password,
          rememberMe: true,
          createdAt: new Date().toISOString()
        };
        setProfile(newProfile);
        saveToStorage('thub-profile', newProfile);
        setCurrentStep('protocol');
      }
    } else {
      // SIGN IN - validate and enter
      if (validateOnboarding()) {
        // Зареждаме от storage за да сме сигурни че имаме актуални данни
        const savedProfile = loadFromStorage('thub-profile', null);
        
        const updatedProfile = {
          ...savedProfile,
          rememberMe: formData.rememberMe || false,
          password: formData.rememberMe ? formData.password : ''
        };
        setProfile(updatedProfile);
        saveToStorage('thub-profile', updatedProfile);
        
        // Проверяваме saved данните, не state-а
        if (savedProfile && savedProfile.protocolConfigured && savedProfile.protocol) {
          setProtocolData(savedProfile.protocol); // Зареждаме запазения протокол
          setActiveTab('today'); // Отиваме в "Днес" таб
          setCurrentStep('main');
        } else {
          setCurrentStep('protocol');
        }
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

          {/* Demo Button for Testing */}
          <button
            onClick={loadDemo}
            style={{ backgroundColor: '#1e3a5f', color: '#22d3ee' }}
            className="w-full py-3 rounded-xl font-medium hover:bg-cyan-900/50 transition-colors mt-3"
          >
            🚀 Demo режим (бърз тест)
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

            <div className="space-y-5">
              {/* Sign Up Fields */}
              {authMode === 'signup' && (
                <>
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                      Име
                    </label>
                    <input
                      type="text"
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
                onClick={handleOnboardingSubmit}
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
            </div>
            
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

    // Calculate stability index
    const calculateStability = () => {
      const halfLife = compound.id.includes('prop') ? 1.5 : 4.5;
      const tmax = compound.id.includes('prop') ? 0.5 : 1.5;
      const bioavailability = 0.70;
      const ka = Math.log(2) / (tmax / 3);
      const ke = Math.log(2) / halfLife;
      
      const injectionInterval = protocolData.frequency === 'ED' ? 1 : 
                                protocolData.frequency === 'EOD' ? 2 : 
                                protocolData.frequency === '3xW' ? 7/3 : 3.5;
      
      // Calculate concentrations for days 28-42 (steady state)
      const concentrations = [];
      for (let i = 28 * 8; i <= 42 * 8; i++) {
        const t = i / 8;
        let concentration = 0;
        
        for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
          const injDay = injNum * injectionInterval;
          const timeSinceInj = t - injDay;
          if (timeSinceInj >= 0 && timeSinceInj < 30) {
            const dose = actualDose * bioavailability;
            const c = dose * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
            concentration += Math.max(0, c);
          }
        }
        concentrations.push(concentration);
      }
      
      const peak = Math.max(...concentrations);
      const trough = Math.min(...concentrations);
      const fluctuation = peak > 0 ? ((peak - trough) / peak) * 100 : 0;
      const stability = Math.round(100 - fluctuation);
      
      return { stability, peak, trough, fluctuation: Math.round(fluctuation) };
    };

    const stabilityData = calculateStability();

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

          {/* PK Graph - Concentration over time */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-4"
          >
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-4 text-center">
              Прогнозна концентрация (6 седмици)
            </label>
            
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart 
                  data={(() => {
                    // Generate PK data using Bateman equation
                    const halfLife = compound.id.includes('prop') ? 1.5 : 4.5;
                    const tmax = compound.id.includes('prop') ? 0.5 : 1.5;
                    const bioavailability = 0.70;
                    const ka = Math.log(2) / (tmax / 3);
                    const ke = Math.log(2) / halfLife;
                    
                    const days = 42;
                    const pointsPerDay = 8; // More points for smoother curve
                    const data = [];
                    
                    const injectionInterval = protocolData.frequency === 'ED' ? 1 : 
                                              protocolData.frequency === 'EOD' ? 2 : 
                                              protocolData.frequency === '3xW' ? 7/3 : 3.5;
                    
                    for (let i = 0; i <= days * pointsPerDay; i++) {
                      const t = i / pointsPerDay;
                      let concentration = 0;
                      
                      // Sum contribution from all previous injections
                      for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
                        const injDay = injNum * injectionInterval;
                        const timeSinceInj = t - injDay;
                        if (timeSinceInj >= 0 && timeSinceInj < 30) { // Only consider last 30 days of injections
                          const dose = actualDose * bioavailability;
                          const c = dose * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
                          concentration += Math.max(0, c);
                        }
                      }
                      
                      // Add every 2nd point for better resolution
                      if (i % 2 === 0) {
                        data.push({ day: Math.round(t * 10) / 10, concentration: Math.round(concentration * 10) / 10 });
                      }
                    }
                    return data;
                  })()}
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="pkGradientProtocol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
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
                    tickFormatter={(v) => Math.round(v)}
                    domain={['dataMin - 5', 'dataMax + 5']}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px' }}
                    labelStyle={{ color: '#94a3b8' }}
                    itemStyle={{ color: '#22d3ee' }}
                    formatter={(value) => [`${value} ${compound.unit}`, 'Концентрация']}
                    labelFormatter={(label) => `Ден ${label}`}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="concentration" 
                    stroke="#06b6d4" 
                    strokeWidth={2}
                    fill="url(#pkGradientProtocol)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            <div style={{ color: '#475569' }} className="text-xs text-center mt-2">
              t½ = {compound.id.includes('prop') ? '1.5' : '4.5'} дни • {freq.name}
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
                    stroke={stabilityData.stability >= 70 ? '#10b981' : stabilityData.stability >= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${stabilityData.stability * 2.51} 251`}
                    style={{
                      filter: `drop-shadow(0 0 8px ${stabilityData.stability >= 70 ? 'rgba(16, 185, 129, 0.5)' : stabilityData.stability >= 50 ? 'rgba(245, 158, 11, 0.5)' : 'rgba(239, 68, 68, 0.5)'})`
                    }}
                  />
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span 
                    className="text-3xl font-bold"
                    style={{ color: stabilityData.stability >= 70 ? '#10b981' : stabilityData.stability >= 50 ? '#f59e0b' : '#ef4444' }}
                  >
                    {stabilityData.stability}%
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
                    <span style={{ color: '#94a3b8' }}>~{stabilityData.fluctuation}%</span>
                  </div>
                  <div style={{ color: '#475569' }} className="text-xs mt-2">
                    Базирано на t½ = {compound.id.includes('prop') ? '1.5' : '4.5'} дни
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

  // Get protocol from profile
  const proto = profile.protocol || protocolData;
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

  // Syringe component for main view
  const SyringeMain = ({ units }) => {
    const maxUnits = proto.graduation === 1 ? 50 : 100;
    const displayUnits = Math.min(units, maxUnits);
    const ticks = proto.graduation === 2
      ? Array.from({ length: 51 }, (_, i) => i * 2)
      : Array.from({ length: 51 }, (_, i) => i);

    return (
      <div className="relative">
        <div 
          style={{ backgroundColor: '#0f172a', borderColor: '#334155', width: '100px', height: '340px' }}
          className="relative border-2 rounded-xl overflow-hidden"
        >
          {ticks.map(tick => {
            const pos = 4 + ((maxUnits - tick) / maxUnits) * 92;
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
                      backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569',
                      width: isMajor ? '16px' : isMedium ? '10px' : '6px',
                      height: isMajor ? '2px' : '1px'
                    }}
                  />
                  {isMajor && (
                    <span style={{ color: '#e2e8f0', fontSize: '10px' }} className="font-bold">{tick}</span>
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
              background: todayCompleted 
                ? 'linear-gradient(to top, #059669, #10b981, #34d399)' 
                : 'linear-gradient(to top, #0891b2, #06b6d4, #22d3ee)',
              height: `${4 + (displayUnits / maxUnits) * 92}%`,
              opacity: 0.7
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
      
      {/* Header */}
      <header 
        style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
        className="px-4 py-3 flex items-center justify-between sticky top-0 z-40 border-b"
      >
        <div className="flex items-center gap-3">
          <div 
            style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
            className="w-10 h-10 rounded-lg border flex items-center justify-center"
          >
            <span className="text-white text-xs font-black">THUB</span>
          </div>
          <div>
            <p className="text-white font-semibold">{profile.name}</p>
            <p style={{ color: '#64748b' }} className="text-xs">{freq.shortName} • {proto.weeklyDose} {compound.unit}/сед</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-4">
        
        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div className="space-y-4">
            
            {/* Date */}
            <div className="text-center">
              <p style={{ color: '#64748b' }} className="text-sm">{dayNames[today.getDay()]}</p>
              <p className="text-white text-3xl font-bold">{today.getDate()} {monthNames[today.getMonth()]}</p>
            </div>

            {todayIsInjectionDay ? (
              <>
                {/* Main Card - Syringe + Dose */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-6"
                >
                  <div className="flex items-center justify-center gap-8">
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

                  {/* ОПГ - вътре в картата */}
                  {rotation && rotation.lowerCount > 0 && rotation.higherCount > 0 && (
                    <div 
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="border rounded-xl p-3 mt-4"
                    >
                      <p style={{ color: '#22d3ee' }} className="font-semibold mb-2 text-sm">Оптимизация на графика</p>
                      
                      <div className="flex justify-center gap-2 mb-2">
                        {(() => {
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
                          return schedule.map((units, i) => (
                            <div 
                              key={i}
                              style={{ 
                                backgroundColor: units === rotation.higherUnits ? '#0891b2' : '#164e63'
                              }}
                              className="px-2 py-1 rounded-lg"
                            >
                              <span className="text-white font-bold text-sm">{units}U</span>
                            </div>
                          ));
                        })()}
                      </div>
                      
                      <p style={{ color: '#94a3b8' }} className="text-xs text-center">
                        {rotation.lowerCount}×{rotation.lowerUnits}U + {rotation.higherCount}×{rotation.higherUnits}U = {rotation.totalMg.toFixed(1)} {compound.unit}
                      </p>
                    </div>
                  )}

                  {/* Location Picker */}
                  <div className="mt-4">
                    <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                      Локация на инжекцията
                    </label>
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
                          className="py-2 border rounded-xl font-medium transition-colors text-xs flex flex-col items-center"
                        >
                          <span className="text-lg">{loc.emoji}</span>
                          <span>{loc.label}</span>
                          {selectedLocation === loc.id && (
                            <span style={{ color: '#22d3ee' }} className="text-xs mt-1">
                              {selectedSide === 'left' ? 'Ляво' : 'Дясно'}
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
                        : 'linear-gradient(90deg, #06b6d4, #14b8a6)' 
                    }}
                    className="w-full mt-6 py-4 text-white font-semibold rounded-xl transition-all"
                  >
                    {todayCompleted 
                      ? `✓ Направено ${injections[todayKey]?.time} ${
                          injections[todayKey]?.location === 'glute' ? '🍑' : 
                          injections[todayKey]?.location === 'delt' ? '💪' : 
                          injections[todayKey]?.location === 'quad' ? '🦵' : 
                          injections[todayKey]?.location === 'abdomen' ? '⭕' : ''
                        }${injections[todayKey]?.side === 'left' ? 'Л' : injections[todayKey]?.side === 'right' ? 'Д' : ''}`
                      : '💉 Маркирай като направено'
                    }
                  </button>
                </div>

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

                {/* PK Graph - Concentration over time */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-4"
                >
                  <p style={{ color: '#64748b' }} className="text-sm font-medium mb-3 text-center">
                    Концентрация (6 седмици)
                  </p>
                  
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart 
                        data={(() => {
                          const halfLife = compound.id.includes('prop') ? 1.5 : 4.5;
                          const tmax = compound.id.includes('prop') ? 0.5 : 1.5;
                          const bioavailability = 0.70;
                          const ka = Math.log(2) / (tmax / 3);
                          const ke = Math.log(2) / halfLife;
                          
                          const days = 42;
                          const pointsPerDay = 8;
                          const data = [];
                          
                          const injectionInterval = proto.frequency === 'ED' ? 1 : 
                                                    proto.frequency === 'EOD' ? 2 : 
                                                    proto.frequency === '3xW' ? 7/3 : 3.5;
                          
                          for (let i = 0; i <= days * pointsPerDay; i++) {
                            const t = i / pointsPerDay;
                            let concentration = 0;
                            
                            for (let injNum = 0; injNum <= Math.floor(t / injectionInterval); injNum++) {
                              const injDay = injNum * injectionInterval;
                              const timeSinceInj = t - injDay;
                              if (timeSinceInj >= 0 && timeSinceInj < 30) {
                                const dose = actualDose * bioavailability;
                                const c = dose * (ka / (ka - ke)) * (Math.exp(-ke * timeSinceInj) - Math.exp(-ka * timeSinceInj));
                                concentration += Math.max(0, c);
                              }
                            }
                            
                            if (i % 2 === 0) {
                              data.push({ day: Math.round(t * 10) / 10, concentration: Math.round(concentration * 10) / 10 });
                            }
                          }
                          return data;
                        })()}
                        margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="pkGradientToday" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
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
                          tickFormatter={(v) => Math.round(v)}
                          domain={['dataMin - 5', 'dataMax + 5']}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px' }}
                          labelStyle={{ color: '#94a3b8' }}
                          itemStyle={{ color: '#22d3ee' }}
                          formatter={(value) => [`${value} ${compound.unit}`, 'Конц.']}
                          labelFormatter={(label) => `Ден ${label}`}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="concentration" 
                          stroke="#06b6d4" 
                          strokeWidth={2}
                          fill="url(#pkGradientToday)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <p style={{ color: '#475569' }} className="text-xs text-center mt-2">
                    t½ = {compound.id.includes('prop') ? '1.5' : '4.5'} дни • {freq.shortName} • {proto.weeklyDose} {compound.unit}/сед
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
                      style={{ 
                        backgroundColor: isInj ? (done ? '#059669' : '#0891b2') : '#1e293b',
                        borderColor: isToday ? '#22d3ee' : 'transparent'
                      }}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs border-2`}
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
              onClick={() => setCurrentStep('onboarding')}
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
