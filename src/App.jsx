import { useState, useEffect, Component } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

// Data
import {
    compounds,
    frequencies,
    compoundNames,
    frequencyNames,
    sourceLabels,
    oilLabels,
    methodLabels,
    monthNames,
    dayNames
} from './data/constants';

// Utils - localStorage + Supabase
import {
    loadFromStorage,
    saveToStorage,
    migrateProfile,
    authSignUp,
    authSignIn,
    authSignOut,
    authResetPassword,
    authGetSession,
    authOnChange,
    dbLoadProfile,
    dbSaveProfile,
    dbLoadProtocol,
    dbSaveProtocol,
    dbLoadInjections,
    dbSaveInjection,
    dbDeleteInjection,
    dbSaveProtocolHistory
} from './utils/storage';

import {
    getPkParameters,
    generatePkData,
    calculateStabilityWithRange
} from './utils/calculations';

// Error Boundary to catch and display crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ backgroundColor: '#0a1628', color: '#f87171', minHeight: '100vh', padding: '2rem' }}>
          <h2 style={{ color: '#fbbf24', fontSize: '1.5rem', marginBottom: '1rem' }}>⚠️ THUB Error</h2>
          <pre style={{ color: '#94a3b8', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button 
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}
          >
            Reset App & Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}


const THUBApp = () => {

  // ============ SUPABASE AUTH STATE ============
  const [userId, setUserId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

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
      injectionLocation: saved.protocol.injectionLocation || 'glute',
      showNowIndicator: saved.protocol.showNowIndicator !== false
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
      injectionLocation: 'glute',
      showNowIndicator: true
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
  const [effectiveFromOption, setEffectiveFromOption] = useState('next'); // 'next' | 'today' | 'custom'
  const [effectiveFromCustomDate, setEffectiveFromCustomDate] = useState('');

  // Log injection modal state
  const [showLogModal, setShowLogModal] = useState(false);
  const [pendingLogDay, setPendingLogDay] = useState(null);
  const [logStatus, setLogStatus] = useState('done'); // 'done' | 'missed'
  const [logTime, setLogTime] = useState('12:00');
  const [logLocation, setLogLocation] = useState('delt');
  const [logSide, setLogSide] = useState('left');
  const [logDose, setLogDose] = useState(0);
  const [logNote, setLogNote] = useState('');
  const [logMissReason, setLogMissReason] = useState('');
  const [autoMissRan, setAutoMissRan] = useState(false);
  // Save injections when changed
  useEffect(() => {
    saveToStorage('thub-injections', injections);
  }, [injections]);

  // Auto-miss on load: mark past unlogged injection days as MISSED
  useEffect(() => {
    if (autoMissRan || !profile.protocolConfigured || !profile.protocol) return;
    setAutoMissRan(true);
    
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const hour = new Date().getHours();
    
    const versions = profile.protocolVersions || [];
    const proto = profile.protocol;
    
    // Inline isInjectionDay check (can't use the function as it's defined later)
    const checkIsInjDay = (date) => {
      // Find protocol version for date
      let p = proto;
      if (versions.length > 0) {
        const checkD = new Date(date);
        checkD.setHours(0, 0, 0, 0);
        const sorted = [...versions].sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
        for (const v of sorted) {
          const effDate = new Date(v.effectiveFrom);
          effDate.setHours(0, 0, 0, 0);
          if (effDate <= checkD) { p = v; break; }
        }
        if (p === proto && sorted.length > 0) p = sorted[sorted.length - 1];
      }
      
      const dayOfWeek = date.getDay();
      const startDate = new Date(p.startDate);
      startDate.setHours(0, 0, 0, 0);
      const checkDate2 = new Date(date);
      checkDate2.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((checkDate2 - startDate) / (1000 * 60 * 60 * 24));
      
      if (p.frequency === 'ED') return true;
      if (p.frequency === 'EOD') return daysDiff >= 0 ? daysDiff % 2 === 0 : Math.abs(daysDiff) % 2 === 0;
      if (p.frequency === '2xW') return dayOfWeek === 1 || dayOfWeek === 4;
      if (p.frequency === '3xW') return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
      return false;
    };
    
    const updated = { ...injections };
    let changed = false;
    
    const startDay = (hour >= 22) ? 0 : 1;
    
    for (let i = startDay; i <= 7; i++) {
      const checkDate = new Date(todayDate);
      checkDate.setDate(checkDate.getDate() - i);
      const dateKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
      
      if (updated[dateKey]) continue;
      if (!checkIsInjDay(checkDate)) continue;
      
      updated[dateKey] = { status: 'missed' };
      changed = true;
    }
    
    if (changed) {
      setInjections(updated);
    }
  }, [profile.protocolConfigured, autoMissRan]);

  // ============ SUPABASE SESSION CHECK ============
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authGetSession();
        if (session?.user) {
          setUserId(session.user.id);
          const dbProfile = await dbLoadProfile(session.user.id);
          const dbProtocol = await dbLoadProtocol(session.user.id);
          const dbInj = await dbLoadInjections(session.user.id);
          
          if (dbProfile) {
            const loadedProfile = {
              name: dbProfile.name || '',
              email: dbProfile.email || '',
              protocolConfigured: dbProfile.protocol_configured || false,
            };
            
            if (dbProtocol) {
              loadedProfile.protocol = dbProtocol;
              loadedProfile.protocolConfigured = true;
              setProtocolData(dbProtocol);
            }
            
            if (dbInj && Object.keys(dbInj).length > 0) {
              setInjections(dbInj);
              saveToStorage('thub-injections', dbInj);
            }
            
            setProfile(loadedProfile);
            saveToStorage('thub-profile', loadedProfile);
            
            if (loadedProfile.protocolConfigured) {
              setCurrentStep('main');
              setActiveTab('today');
            } else {
              setCurrentStep('protocol');
            }
          }
        }
      } catch (err) {
        console.error('Session check error:', err);
      } finally {
        setAuthLoading(false);
      }
    };
    checkSession();
    
    const { data: { subscription } } = authOnChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserId(null);
        setCurrentStep('onboarding');
      }
    });
    
    return () => subscription.unsubscribe();
  }, []);

  // ============ PROTOCOL CHANGE DETECTION ============
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


  // Reset function - Supabase logout
  const resetApp = async () => {
    try {
      await authSignOut();
    } catch (e) {}
    localStorage.removeItem('thub-profile');
    localStorage.removeItem('thub-injections');
    setUserId(null);
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
    setAuthError('');
    
    if (authMode === 'signup') {
      if (validateOnboarding()) {
        setAuthLoading(true);
        const { data, error } = await authSignUp(
          formData.email.trim(),
          formData.password,
          formData.name.trim()
        );
        
        if (error) {
          setAuthError(error);
          setAuthLoading(false);
          return;
        }
        
        if (data?.user) {
          setUserId(data.user.id);
          const newProfile = {
            name: formData.name.trim(),
            email: formData.email.trim(),
            protocolConfigured: false,
            createdAt: new Date().toISOString()
          };
          setProfile(newProfile);
          saveToStorage('thub-profile', newProfile);
          setCurrentStep('protocol');
        }
        setAuthLoading(false);
      }
    } else {
      if (validateOnboarding()) {
        setAuthLoading(true);
        const { data, error } = await authSignIn(
          formData.email.trim(),
          formData.password
        );
        
        if (error) {
          setAuthError(error);
          setAuthLoading(false);
          return;
        }
        
        if (data?.user) {
          setUserId(data.user.id);
          const dbProfile = await dbLoadProfile(data.user.id);
          const dbProtocol = await dbLoadProtocol(data.user.id);
          const dbInj = await dbLoadInjections(data.user.id);
          
          const loadedProfile = {
            name: dbProfile?.name || formData.email.trim(),
            email: formData.email.trim(),
            protocolConfigured: false,
          };
          
          if (dbProtocol) {
            loadedProfile.protocol = dbProtocol;
            loadedProfile.protocolConfigured = true;
            setProtocolData(dbProtocol);
          }
          
          if (dbInj && Object.keys(dbInj).length > 0) {
            setInjections(dbInj);
            saveToStorage('thub-injections', dbInj);
          }
          
          setProfile(loadedProfile);
          saveToStorage('thub-profile', loadedProfile);
          
          if (loadedProfile.protocolConfigured) {
            setActiveTab('today');
            setCurrentStep('main');
          } else {
            setCurrentStep('protocol');
          }
        }
        setAuthLoading(false);
      }
    }
  };

  const handleForgotPassword = async () => {
    if (!formData.email || !formData.email.includes('@')) {
      setAuthError('Въведи имейл адрес');
      return;
    }
    const { error } = await authResetPassword(formData.email.trim());
    if (error) {
      setAuthError(error);
    } else {
      setResetEmailSent(true);
      setAuthError('');
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
        setEffectiveFromOption('next');
        setEffectiveFromCustomDate(new Date().toISOString().split('T')[0]);
        setShowChangeModal(true);
        return;
      }
    }
    
    // Няма промени или е нов протокол - запазваме директно
    saveProtocol();
  };

  // Find next injection date from today using CURRENT protocol
  const getNextInjectionDateFromToday = () => {
    const proto = profile.protocol;
    if (!proto) return new Date().toISOString().split('T')[0];
    const freq = proto.frequency;
    const startDate = new Date(proto.startDate);
    startDate.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    for (let i = 1; i <= 14; i++) {
      const check = new Date(now);
      check.setDate(check.getDate() + i);
      check.setHours(0, 0, 0, 0);
      const dayOfWeek = check.getDay();
      const daysDiff = Math.floor((check - startDate) / (1000 * 60 * 60 * 24));
      
      let isInj = false;
      if (freq === 'ED') isInj = true;
      else if (freq === 'EOD') isInj = daysDiff >= 0 ? daysDiff % 2 === 0 : Math.abs(daysDiff) % 2 === 0;
      else if (freq === '2xW') isInj = dayOfWeek === 1 || dayOfWeek === 4;
      else if (freq === '3xW') isInj = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
      
      if (isInj) return check.toISOString().split('T')[0];
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  // Calculate effective date based on selected option
  const getEffectiveDate = () => {
    if (effectiveFromOption === 'custom') return effectiveFromCustomDate;
    return getNextInjectionDateFromToday(); // 'next'
  };


  const saveProtocol = async (reason = null) => {
    const now = new Date().toISOString();
    
    let newVersions = profile.protocolVersions || [];
    
    if (reason && profile.protocol) {
      const effectiveFrom = getEffectiveDate();
      const newVersion = {
        ...protocolData,
        effectiveFrom: effectiveFrom,
        createdAt: now,
        note: reason
      };
      newVersions = [...newVersions, newVersion];
    } else if (!profile.protocolConfigured) {
      newVersions = [{
        ...protocolData,
        effectiveFrom: protocolData.startDate,
        createdAt: now,
        note: null
      }];
    }
    
    let newHistory = profile.protocolHistory || [];
    if (reason && profile.protocol) {
      const historyEntry = {
        date: now,
        reason: reason,
        changes: detectedChanges.map(c => `${c.field}: ${c.from} → ${c.to}`).join(', '),
        oldProtocol: { ...profile.protocol },
        newProtocol: { ...protocolData },
        effectiveFrom: getEffectiveDate(),
        effectiveMethod: effectiveFromOption === 'next' ? 'Следваща инжекция' : 'Избрана дата'
      };
      newHistory = [...newHistory, historyEntry];
    }
    
    const newProfile = {
      ...profile,
      protocol: protocolData,
      protocolConfigured: true,
      protocolVersions: newVersions,
      protocolHistory: newHistory,
      lastModified: now
    };
    
    setProfile(newProfile);
    saveToStorage('thub-profile', newProfile);
    
    // === SUPABASE SYNC ===
    if (userId) {
      await dbSaveProfile(userId, { name: newProfile.name, email: newProfile.email, protocolConfigured: true });
      const protocolToSave = { ...protocolData, effectiveFrom: protocolData.effectiveFrom || protocolData.startDate, note: reason };
      const { data: savedProto } = await dbSaveProtocol(userId, protocolToSave);
      
      if (reason && profile.protocol && savedProto) {
        const changesStr = detectedChanges.map(c => `${c.field}: ${c.from} -> ${c.to}`).join(', ');
        await dbSaveProtocolHistory(userId, savedProto.id, changesStr, reason, profile.protocol, protocolData);
      }
    }
    
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

  // Loading screen while checking auth
  if (authLoading && !loadFromStorage('thub-profile', null)) {
    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="flex items-center justify-center">
        <div className="text-center">
          <div style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }} className="w-20 h-20 rounded-2xl border-2 flex items-center justify-center mb-4 mx-auto shadow-xl">
            <span className="text-white text-lg font-black tracking-tight">THUB</span>
          </div>
          <p style={{ color: '#64748b' }}>Зареждане...</p>
        </div>
      </div>
    );
  }
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


              {/* Auth Error Display */}
              {authError && (
                <div style={{ backgroundColor: '#7f1d1d', borderColor: '#dc2626' }} className="border rounded-xl p-3">
                  <p className="text-red-300 text-sm text-center">{authError}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handleOnboardingSubmit}
                style={{ background: 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
                className="w-full py-4 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:opacity-90 mt-2"
              >
                {authLoading ? '...' : (authMode === 'signup' ? 'Create Account' : 'Sign In')}
              </button>

              {/* Forgot password - signin only */}
              {authMode === 'signin' && (
                <p style={{ color: '#64748b' }} className="text-sm text-center">
                <button
                  onClick={handleForgotPassword}
                  style={{ color: '#64748b' }}
                  className="text-sm text-center w-full hover:text-cyan-400 transition-colors"
                >
                  {resetEmailSent ? '✉️ Изпратен е имейл за възстановяване' : 'Забравена парола?'}
                </button>
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
      { id: 'test_u_250', name: 'Testosterone Undecanoate 250mg/mL', concentration: 250, unit: 'mg' },
      { id: 'hcg', name: 'HCG 5000IU / 5mL', concentration: 1000, unit: 'IU' },
    ];

    const frequencies = [
      { id: 'ED', name: 'Всеки ден (ED)', perWeek: 7 },
      { id: 'EOD', name: 'През ден (EOD)', perWeek: 3.5 },
      { id: '3xW', name: '3× седмично (Пон/Ср/Пет)', perWeek: 3 },
      { id: '2xW', name: '2× седмично (Пон/Чет)', perWeek: 2 },
      { id: '1xW', name: '1× седмично', perWeek: 1 },
      { id: '1x2W', name: '1× на 2 седмици', perWeek: 0.5 },
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

    // Rotation calculation for protocol screen
    const protoInjectionsPerPeriod = protocolData.frequency === 'EOD' ? 7 : freq.perWeek;
    const protoTargetPerPeriod = protocolData.frequency === 'EOD' ? protocolData.weeklyDose * 2 : protocolData.weeklyDose;

    const protoRotation = (() => {
      const lower = Math.floor(unitsRaw / protocolData.graduation) * protocolData.graduation;
      const higher = lower + protocolData.graduation;
      if (lower <= 0 || higher > 100) return null;
      const lowerDose = (lower / 100) * compound.concentration;
      const higherDose = (higher / 100) * compound.concentration;
      let bestCombo = null;
      let bestDelta = Infinity;
      for (let higherCount = 0; higherCount <= protoInjectionsPerPeriod; higherCount++) {
        const lowerCount = protoInjectionsPerPeriod - higherCount;
        const totalMg = (lowerCount * lowerDose) + (higherCount * higherDose);
        const delta = Math.abs(totalMg - protoTargetPerPeriod);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestCombo = { lowerCount, higherCount, lowerUnits: lower, higherUnits: higher };
        }
      }
      if (bestCombo && bestCombo.lowerCount > 0 && bestCombo.higherCount > 0) return bestCombo;
      return null;
    })();

    // Today's dose (considering rotation)
    const protoTodayDose = (() => {
      if (!protoRotation) return unitsRounded;
      const today = new Date();
      const startDate = new Date(protocolData.startDate);
      startDate.setHours(0, 0, 0, 0);
      const checkDate = new Date(today);
      checkDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));
      const dayOfWeek = today.getDay();

      let injectionIndex = 0;
      if (protocolData.frequency === 'ED') {
        injectionIndex = ((daysDiff % 7) + 7) % 7;
      } else if (protocolData.frequency === 'EOD') {
        const injNum = Math.floor(daysDiff / 2);
        injectionIndex = ((injNum % 7) + 7) % 7;
      } else if (protocolData.frequency === '2xW') {
        const weekNum = Math.floor(daysDiff / 7);
        const posInWeek = dayOfWeek === 1 ? 0 : 1;
        injectionIndex = (weekNum * 2 + posInWeek) % 2;
      } else if (protocolData.frequency === '3xW') {
        const weekNum = Math.floor(daysDiff / 7);
        const posInWeek = dayOfWeek === 1 ? 0 : dayOfWeek === 3 ? 1 : 2;
        injectionIndex = (weekNum * 3 + posInWeek) % 3;
      }

      const schedule = [];
      let higherUsed = 0;
      for (let i = 0; i < protoInjectionsPerPeriod; i++) {
        const expectedHigher = Math.round((i + 1) * protoRotation.higherCount / protoInjectionsPerPeriod);
        if (higherUsed < expectedHigher) {
          schedule.push(protoRotation.higherUnits);
          higherUsed++;
        } else {
          schedule.push(protoRotation.lowerUnits);
        }
      }
      return schedule[injectionIndex % schedule.length];
    })();

    const todayDoseMg = (protoTodayDose / 100) * compound.concentration;
    const todayDoseMl = protoTodayDose / 100;
    const dosesDiffer = protoRotation && protoTodayDose !== unitsRounded;

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

          {/* Dose Summary */}
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-5"
          >
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div style={{ color: '#64748b' }} className="text-xs mb-1">Доза/инжекция</div>
                <div style={{ color: '#22d3ee' }} className="text-4xl font-bold">{unitsRounded}U</div>
              </div>
              <div style={{ backgroundColor: '#1e3a5f', width: '1px', height: '50px' }} />
              <div className="text-center flex-1">
                <div style={{ color: '#64748b' }} className="text-xs mb-1">Активно вещество</div>
                <div style={{ color: 'white' }} className="text-xl font-bold">{actualDose.toFixed(1)} {compound.unit}</div>
              </div>
              <div style={{ backgroundColor: '#1e3a5f', width: '1px', height: '50px' }} />
              <div className="text-center flex-1">
                <div style={{ color: '#64748b' }} className="text-xs mb-1">Обем</div>
                <div style={{ color: 'white' }} className="text-xl font-bold">{actualMl.toFixed(2)} mL</div>
              </div>
            </div>
            {dosesDiffer && (
              <div className="flex items-center justify-center gap-2 mt-3 pt-3">
                <span className="text-sm">ℹ️</span>
                <span style={{ color: '#e2e8f0' }} className="text-sm">
                  Оптимизирана доза днес: <span style={{ color: '#22d3ee' }} className="font-bold">{protoTodayDose}U</span> · {todayDoseMg.toFixed(1)} {compound.unit} · {todayDoseMl.toFixed(2)} mL
                </span>
              </div>
            )}
          </div>

          {/* PK Graph */}
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
                      return [null, null];
                    }}
                    labelFormatter={(label) => `Ден ${Math.round(label * 10) / 10}`}
                  />
                  <Area 
                    type="natural" 
                    dataKey="percentMax"
                    stroke="none"
                    fill="url(#pkBandGradient)"
                    legendType="none"
                  />
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

          {/* Stability Index */}
          {(() => {
            const val = stabilityData.stability.base;
            const valMin = stabilityData.stability.min;
            const valMax = stabilityData.stability.max;

            const cx = 100, cy = 100, r = 80;
            const strokeW = 14;
            const gapDeg = 90;
            const arcDeg = 360 - gapDeg;
            const startDeg = 135;
            const circumference = 2 * Math.PI * r;
            const arcLen = (arcDeg / 360) * circumference;
            const progressLen = (val / 100) * arcLen;

            return (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-6"
              >
                <div className="flex flex-col items-center">
                  <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">
                    Индекс на стабилност
                  </label>

                  <div className="relative" style={{ width: '180px', height: '180px' }}>
                    <svg viewBox="0 0 200 200" className="w-full h-full">
                      <defs>
                        <filter id="arcGlow">
                          <feGaussianBlur stdDeviation="6" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                        <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#06b6d4" />
                          <stop offset="100%" stopColor="#22d3ee" />
                        </linearGradient>
                      </defs>

                      <circle
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke="#1e293b"
                        strokeWidth={strokeW}
                        strokeLinecap="round"
                        strokeDasharray={`${arcLen} ${circumference}`}
                        strokeDashoffset={0}
                        transform={`rotate(${startDeg} ${cx} ${cy})`}
                      />

                      <circle
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke="url(#arcGrad)"
                        strokeWidth={strokeW}
                        strokeLinecap="round"
                        strokeDasharray={`${progressLen} ${circumference}`}
                        strokeDashoffset={0}
                        transform={`rotate(${startDeg} ${cx} ${cy})`}
                        filter="url(#arcGlow)"
                      />
                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span 
                        className="text-2xl font-bold"
                        style={{ color: '#e2e8f0' }}
                      >
                        ~{valMin}-{valMax}%
                      </span>
                    </div>
                  </div>

                  <div className="w-full grid grid-cols-2 gap-3 mt-3">
                    <div 
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="border rounded-xl p-3 text-center"
                    >
                      <div style={{ color: '#64748b' }} className="text-sm font-medium mb-1">Ниво преди следваща доза</div>
                      <div style={{ color: '#e2e8f0' }} className="text-lg font-bold">~{stabilityData.troughPercent.min}-{stabilityData.troughPercent.max}%</div>
                      <div style={{ color: '#64748b' }} className="text-xs">от peak</div>
                    </div>
                    <div 
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                      className="border rounded-xl p-3 text-center"
                    >
                      <div style={{ color: '#64748b' }} className="text-sm font-medium mb-1">Амплитуда на нивата</div>
                      <div style={{ color: '#e2e8f0' }} className="text-lg font-bold">~{stabilityData.fluctuation.min}-{stabilityData.fluctuation.max}%</div>
                      <div style={{ color: '#64748b' }} className="text-xs">peak → trough</div>
                    </div>
                  </div>

                  <p style={{ color: '#334155' }} className="text-xs text-center mt-3">
                    Базирано на средни фармакокинетични данни. Индивидуалната реакция варира.
                  </p>
                </div>
              </div>
            );
          })()}

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

              {/* Effective From */}
              <div className="mb-4">
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                  Промяната важи от:
                </label>
                <div className="space-y-2">
                  {[
                    { id: 'next', label: `От следващата инжекция (${getNextInjectionDateFromToday()})` },
                    { id: 'custom', label: 'Избери дата' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setEffectiveFromOption(opt.id)}
                      style={{ 
                        backgroundColor: effectiveFromOption === opt.id ? 'rgba(6, 182, 212, 0.15)' : '#0a1628',
                        borderColor: effectiveFromOption === opt.id ? '#0891b2' : '#1e3a5f'
                      }}
                      className="w-full px-4 py-3 border rounded-xl text-left text-sm transition-all"
                    >
                      <span style={{ color: effectiveFromOption === opt.id ? '#22d3ee' : '#94a3b8' }}>
                        {effectiveFromOption === opt.id ? '● ' : '○ '}{opt.label}
                      </span>
                    </button>
                  ))}
                  {effectiveFromOption === 'custom' && (
                    <input
                      type="date"
                      value={effectiveFromCustomDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setEffectiveFromCustomDate(e.target.value)}
                      style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                      className="w-full px-4 py-3 border rounded-xl focus:outline-none mt-2"
                    />
                  )}
                </div>
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
    { id: 'test_u_250', name: 'Testosterone Undecanoate 250mg/mL', shortName: 'Test Undecanoate 250', concentration: 250, unit: 'mg' },
    { id: 'hcg', name: 'HCG 5000IU / 5mL', shortName: 'HCG', concentration: 1000, unit: 'IU' },
  ];

  const frequenciesData = [
    { id: 'ED', name: 'Всеки ден', shortName: 'ED', perWeek: 7, periodDays: 7 },
    { id: 'EOD', name: 'През ден', shortName: 'EOD', perWeek: 3.5, periodDays: 14 },
    { id: '3xW', name: '3× седмично', shortName: '3xW', perWeek: 3, periodDays: 7 },
    { id: '2xW', name: '2× седмично', shortName: '2xW', perWeek: 2, periodDays: 7 },
    { id: '1xW', name: '1× седмично', shortName: '1xW', perWeek: 1, periodDays: 7 },
    { id: '1x2W', name: '1× на 2 седмици', shortName: '1x2W', perWeek: 0.5, periodDays: 14 },
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

  // Get PK parameters for main view
  const pkParamsMain = getPkParameters(
    proto.compound,
    proto.injectionMethod,
    proto.oilType,
    proto.injectionLocation,
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
      
      if (daysSince >= 0 && daysSince < halfLife * 10) {
        const d = actualDose * bio;
        const c = d * (ka / (ka - ke)) * (Math.exp(-ke * daysSince) - Math.exp(-ka * daysSince));
        currentConcentration += Math.max(0, c);
      }
    }

    // Calculate THEORETICAL steady state peak
    const injectionInterval = proto.frequency === 'ED' ? 1 : 
                              proto.frequency === 'EOD' ? 2 : 
                              proto.frequency === '3xW' ? 7/3 : 
                              proto.frequency === '1xW' ? 7 :
                              proto.frequency === '1x2W' ? 14 : 3.5;
    
    let steadyStatePeak = 0;
    for (let checkDay = 28; checkDay <= 42; checkDay += 0.1) {
      let conc = 0;
      for (let injNum = 0; injNum <= Math.floor(checkDay / injectionInterval); injNum++) {
        const injDay = injNum * injectionInterval;
        const timeSinceInj = checkDay - injDay;
        if (timeSinceInj >= 0 && timeSinceInj < halfLife * 10) {
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

  // Get protocol version that applies to a specific date
  const getProtocolForDate = (date) => {
    const versions = profile.protocolVersions || [];
    if (versions.length === 0) return proto;
    
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    
    // Sort by effectiveFrom descending
    const sorted = [...versions].sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
    
    // Find first version where effectiveFrom <= date
    for (const v of sorted) {
      const effDate = new Date(v.effectiveFrom);
      effDate.setHours(0, 0, 0, 0);
      if (effDate <= checkDate) return v;
    }
    
    // Fallback to earliest version
    return sorted[sorted.length - 1];
  };

  // Check if today is injection day
  const isInjectionDay = (date) => {
    const p = getProtocolForDate(date);
    const dayOfWeek = date.getDay();
    const startDate = new Date(p.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));

    if (p.frequency === 'ED') return true;
    if (p.frequency === 'EOD') return daysDiff >= 0 ? daysDiff % 2 === 0 : Math.abs(daysDiff) % 2 === 0;
    if (p.frequency === '2xW') return dayOfWeek === 1 || dayOfWeek === 4;
    if (p.frequency === '3xW') return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    return false;
  };

  const todayIsInjectionDay = isInjectionDay(today);

  const todayEntry = injections[todayKey];
  const todayDone = todayEntry && (todayEntry.status === 'done' || !todayEntry.status);
  const todayMissed = todayEntry && todayEntry.status === 'missed';
  const todayCompleted = todayDone; // backward compat for other references

  // Check for missed injections in the last 7 days
  const hasMissedInjection = () => {
    // Use earliest startDate from all versions
    const versions = profile.protocolVersions || [];
    const earliestStart = versions.length > 0 
      ? new Date(versions.reduce((min, v) => v.startDate < min ? v.startDate : min, versions[0].startDate))
      : new Date(proto.startDate);
    earliestStart.setHours(0, 0, 0, 0);
    
    for (let i = 1; i <= 7; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      checkDate.setHours(0, 0, 0, 0);
      
      // Don't check before protocol start
      if (checkDate < earliestStart) continue;
      
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

  // Open log modal with defaults (or existing data for edit)
  const openLogModal = (dayKey, dayDose, isToday = false, existingData = null, defaultStatus = 'done') => {
    const now = new Date();
    const defaultTime = isToday 
      ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      : '12:00';
    
    setPendingLogDay(dayKey);
    setLogStatus(existingData?.status || defaultStatus);
    setLogTime(existingData?.time || defaultTime);
    setLogLocation(existingData?.location || selectedLocation);
    setLogSide(existingData?.side || selectedSide);
    setLogDose(existingData?.dose || dayDose);
    setLogNote(existingData?.note || '');
    setLogMissReason(existingData?.missReason || '');
    setShowLogModal(true);
  };

  // Save injection from modal
  const saveLoggedInjection = () => {
    if (!pendingLogDay) return;
    
    if (logStatus === 'missed') {
      setInjections(prev => ({
        ...prev,
        [pendingLogDay]: {
          status: 'missed',
          missReason: logMissReason || undefined,
          note: logNote || undefined
        }
      }));
    } else {
      setInjections(prev => ({
        ...prev,
        [pendingLogDay]: {
          status: 'done',
          time: logTime,
          dose: logDose,
          location: logLocation,
          side: logSide,
          note: logNote || undefined
        }
      }));
      
      // Update selected location/side for next time
      setSelectedLocation(logLocation);
      setSelectedSide(logSide);
    }
    
    setShowLogModal(false);
    setPendingLogDay(null);
  };

  // Remove logged injection
  const removeLoggedInjection = (dayKey) => {
    setInjections(prev => {
      const newState = { ...prev };
      delete newState[dayKey];
      return newState;
    });
  };

  // Get dose for specific date (version-aware with rotation)
  const getDoseForDate = (date) => {
    if (!isInjectionDay(date)) return null;
    
    const p = getProtocolForDate(date);
    const comp = compounds.find(c => c.id === p.compound) || compounds[0];
    const fr = frequenciesData.find(f => f.id === p.frequency) || frequenciesData[1];
    
    const dosePI = p.weeklyDose / fr.perWeek;
    const mlPI = dosePI / comp.concentration;
    const uRaw = mlPI * 100;
    const uRounded = Math.round(uRaw / p.graduation) * p.graduation;
    
    // Calculate rotation for this version
    const injPerPeriod = p.frequency === 'EOD' ? 7 : fr.perWeek;
    const targetPP = p.frequency === 'EOD' ? p.weeklyDose * 2 : p.weeklyDose;
    
    const lower = Math.floor(uRaw / p.graduation) * p.graduation;
    const higher = lower + p.graduation;
    
    let rot = null;
    if (lower > 0 && lower !== higher && higher <= 100) {
      const lowerDose = (lower / 100) * comp.concentration;
      const higherDose = (higher / 100) * comp.concentration;
      let bestCombo = null;
      let bestDelta = Infinity;
      for (let hc = 0; hc <= injPerPeriod; hc++) {
        const lc = injPerPeriod - hc;
        const totalMg = (lc * lowerDose) + (hc * higherDose);
        const delta = Math.abs(totalMg - targetPP);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestCombo = { lowerCount: lc, higherCount: hc, lowerUnits: lower, higherUnits: higher };
        }
      }
      if (bestCombo && bestCombo.lowerCount > 0 && bestCombo.higherCount > 0) {
        rot = bestCombo;
      }
    }
    
    if (!rot) return uRounded;

    const startDate = new Date(p.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));
    const dayOfWeek = date.getDay();

    let injectionIndex = 0;
    if (p.frequency === 'ED') {
      injectionIndex = ((daysDiff % 7) + 7) % 7;
    } else if (p.frequency === 'EOD') {
      const injectionNumber = Math.floor(daysDiff / 2);
      injectionIndex = ((injectionNumber % 7) + 7) % 7;
    } else if (p.frequency === '2xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : 1;
      injectionIndex = (weekNumber * 2 + positionInWeek) % 2;
    } else if (p.frequency === '3xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : dayOfWeek === 3 ? 1 : 2;
      injectionIndex = (weekNumber * 3 + positionInWeek) % 3;
    }

    // Build rotation schedule
    const schedule = [];
    let higherUsed = 0;
    for (let i = 0; i < injPerPeriod; i++) {
      const expectedHigher = Math.round((i + 1) * rot.higherCount / injPerPeriod);
      if (higherUsed < expectedHigher) {
        schedule.push(rot.higherUnits);
        higherUsed++;
      } else {
        schedule.push(rot.lowerUnits);
      }
    }

    return schedule[injectionIndex % schedule.length];
  };

  const todayDose = getDoseForDate(today) || unitsRounded;

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
          style={{ backgroundColor: '#0f172a', borderColor: '#334155', width: '125px', height: '500px' }}
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
                <div className="flex items-center justify-between px-1.5">
                  <div 
                    style={{ 
                      backgroundColor: isMajor ? '#f1f5f9' : isMedium ? '#94a3b8' : '#64748b',
                      width: isMajor ? '20px' : isMedium ? '14px' : '8px',
                      height: isMajor ? '3px' : isMedium ? '2px' : '1px'
                    }}
                  />
                  {isMajor && (
                    <span style={{ color: '#f1f5f9', fontSize: '13px' }} className="font-bold">{tick}</span>
                  )}
                  <div 
                    style={{ 
                      backgroundColor: isMajor ? '#f1f5f9' : isMedium ? '#94a3b8' : '#64748b',
                      width: isMajor ? '20px' : isMedium ? '14px' : '8px',
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
                {/* Date */}
                <div className="text-center pb-1">
                  <span style={{ color: '#475569' }} className="text-sm font-medium">
                    {dayNames[today.getDay()]} {today.getDate().toString().padStart(2, '0')}/{(today.getMonth() + 1).toString().padStart(2, '0')}
                  </span>
                </div>

                {/* Hero Card - Syringe + Dose */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-8"
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
                        <p>{((todayDose / 100) * compound.concentration).toFixed(1)} {compound.unit}</p>
                        <p>{(todayDose / 100).toFixed(2)} mL</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Location Picker */}
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-4"
                >
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { id: 'glute', label: 'Глутеус', emoji: '🍑' },
                      { id: 'delt', label: 'Делтоид', emoji: '💪' },
                      { id: 'quad', label: 'Бедро', emoji: '🦵' },
                      { id: 'abdomen', label: 'Корем', emoji: '⭕' }
                    ].map(loc => {
                      const isSelected = selectedLocation === loc.id;
                      return (
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
                            backgroundColor: isSelected ? 'rgba(8, 145, 178, 0.15)' : '#0a1628',
                            borderColor: isSelected ? '#0891b2' : '#1e3a5f',
                            opacity: todayCompleted ? 0.5 : 1
                          }}
                          className="py-3 border rounded-xl transition-all duration-200 flex flex-col items-center gap-1"
                        >
                          <span className="text-lg">{loc.emoji}</span>
                          <span style={{ color: isSelected ? '#22d3ee' : '#94a3b8' }} className="text-xs font-medium">{loc.label}</span>
                          {isSelected && selectedSide && (
                            <span style={{ color: '#0891b2' }} className="text-xs font-medium">
                              {selectedSide === 'left' ? 'Ляво' : 'Дясно'}
                            </span>
                          )}
                        </button>
                      );
                    })}
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
                {todayDone ? (
                  <button
                    onClick={() => openLogModal(todayKey, todayDose, true, todayEntry)}
                    style={{ background: 'linear-gradient(90deg, #059669, #10b981)' }}
                    className="w-full py-4 text-white font-semibold rounded-xl transition-all"
                  >
                    {`✓ Направено ${todayEntry?.time} ${
                      todayEntry?.location === 'glute' ? '🍑' : 
                      todayEntry?.location === 'delt' ? '💪' : 
                      todayEntry?.location === 'quad' ? '🦵' : 
                      todayEntry?.location === 'abdomen' ? '⭕' : ''
                    }${todayEntry?.side === 'left' ? 'Л' : todayEntry?.side === 'right' ? 'Д' : ''}`}
                  </button>
                ) : todayMissed ? (
                  <div>
                    <button
                      onClick={() => openLogModal(todayKey, todayDose, true, todayEntry, 'missed')}
                      style={{ background: 'linear-gradient(90deg, #d97706, #f59e0b)' }}
                      className="w-full py-4 text-white font-semibold rounded-xl transition-all"
                    >
                      ⚠️ Пропуснато — добави причина
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        setInjections(prev => ({
                          ...prev,
                          [todayKey]: { status: 'done', time: timeStr, dose: todayDose, location: selectedLocation, side: selectedSide }
                        }));
                      }}
                      style={{ color: '#34d399' }}
                      className="w-full mt-2 py-2 text-sm hover:underline transition-colors text-center"
                    >
                      Все пак го направих →
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => {
                        const now = new Date();
                        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        setInjections(prev => ({
                          ...prev,
                          [todayKey]: { status: 'done', time: timeStr, dose: todayDose, location: selectedLocation, side: selectedSide }
                        }));
                      }}
                      style={{ 
                        background: missedInjection 
                          ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                          : 'linear-gradient(90deg, #06b6d4, #14b8a6)' 
                      }}
                      className={`w-full py-4 text-white font-semibold rounded-xl transition-all ${
                        missedInjection ? 'animate-pulse' : ''
                      }`}
                    >
                      💉 Маркирай като направено
                    </button>
                    <button
                      onClick={() => openLogModal(todayKey, todayDose, true, null, 'missed')}
                      style={{ color: '#d97706' }}
                      className="w-full mt-2 py-2 text-sm hover:underline transition-colors text-center"
                    >
                      Маркирай пропуск →
                    </button>
                  </div>
                )}

                {/* Optimization в Today */}
                {(() => {
                  const isEOD = proto.frequency === 'EOD';
                  const cycleDays = isEOD ? 14 : 7;
                  const todayDate = new Date();
                  const todayDayOfWeek = todayDate.getDay();
                  const mondayOfWeek = new Date(todayDate);
                  const daysFromMonday = todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1;
                  mondayOfWeek.setDate(todayDate.getDate() - daysFromMonday);
                  const dayNamesShort = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
                  
                  const cycleData = [];
                  for (let i = 0; i < cycleDays; i++) {
                    const dayDate = new Date(mondayOfWeek);
                    dayDate.setDate(mondayOfWeek.getDate() + i);
                    const isInjDay = isInjectionDay(dayDate);
                    const dose = isInjDay ? (getDoseForDate(dayDate) || unitsRounded) : 0;
                    const dayKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
                    const entry = injections[dayKey];
                    const isDone = entry && (entry.status === 'done' || !entry.status);
                    const isMissed = entry && entry.status === 'missed';
                    const isTodayDay = dayDate.toDateString() === todayDate.toDateString();
                    const isFuture = dayDate > todayDate;
                    const dayName = dayNamesShort[dayDate.getDay()];
                    cycleData.push({ dayName, dose, isDone, isMissed, isToday: isTodayDay, isFuture, isInjDay });
                  }
                  
                  const cycleInjections = cycleData.filter(d => d.isInjDay);
                  const cycleTotalMg = cycleInjections.reduce((sum, d) => sum + (d.dose / 100 * compound.concentration), 0);
                  const weeklyMg = isEOD ? cycleTotalMg / 2 : cycleTotalMg;
                  const doseCounts = {};
                  cycleInjections.forEach(d => { doseCounts[d.dose] = (doseCounts[d.dose] || 0) + 1; });
                  const doseFormula = Object.entries(doseCounts)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([dose, count]) => `${count}×${dose}U`)
                    .join(' + ');
                  
                  return (
                    <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
                      <div className="overflow-x-auto pt-1 pb-1">
                        <div className="flex gap-2 min-w-max justify-center px-1">
                          {cycleData.map((day, i) => {
                            const isPlanned = !day.isDone && !day.isMissed;
                            const showPulse = day.isToday && isPlanned && day.isInjDay;
                            return (
                              <div key={i} style={{ 
                                backgroundColor: 'transparent',
                                border: '1px solid #1e3a5f',
                                borderLeft: day.isDone ? '3px solid #059669' : day.isMissed ? '3px solid #d97706' : '1px solid #1e3a5f',
                                width: '46px',
                                opacity: day.isFuture ? 0.5 : 1,
                                animation: showPulse ? 'pulse 2s infinite' : 'none',
                                boxShadow: showPulse ? '0 0 0 2px rgba(34, 211, 238, 0.4)' : 'none',
                              }} className="py-2 rounded-lg text-center flex-shrink-0">
                                <div style={{ color: '#94a3b8', fontSize: '10px' }}>{day.dayName}</div>
                                <div style={{ color: '#e2e8f0', fontWeight: 'bold', fontSize: '12px' }}>
                                  {day.dose}U
                                </div>
                                {day.isDone && <div style={{ color: '#34d399', fontSize: '12px', lineHeight: 1, marginTop: '-1px' }}>✓</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <p style={{ color: '#94a3b8' }} className="text-xs text-center mt-2">
                        {doseFormula} = {weeklyMg.toFixed(1)} {compound.unit}/сед
                      </p>
                    </div>
                  );
                })()}
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
                  const entry = injections[dateKey];
                  const isDone = entry && (entry.status === 'done' || !entry.status); // backward compat
                  const isMissed = entry && entry.status === 'missed';
                  const hasEntry = !!entry;
                  const doneTime = isDone ? entry?.time : null;
                  const doneLocation = isDone ? entry?.location : null;
                  const doneSide = isDone ? entry?.side : null;
                  const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                  const isFuture = date > today;
                  const dose = isInj ? (getDoseForDate(date) || unitsRounded) : 0;
                  const canClick = !isFuture;

                  const locationEmoji = doneLocation === 'glute' ? '🍑' : 
                                        doneLocation === 'delt' ? '💪' : 
                                        doneLocation === 'quad' ? '🦵' : 
                                        doneLocation === 'abdomen' ? '⭕' : '';
                  const sideLabel = doneSide === 'left' ? 'Л' : doneSide === 'right' ? 'Д' : '';

                  cells.push(
                    <button
                      key={day}
                      onClick={() => {
                        if (!canClick) return;
                        if (hasEntry) {
                          openLogModal(dateKey, dose, isToday, entry);
                        } else {
                          openLogModal(dateKey, dose, isToday);
                        }
                      }}
                      disabled={!canClick}
                      style={{ 
                        backgroundColor: isDone ? '#059669' : isMissed ? '#92400e' : isInj ? '#0891b2' : '#1e293b',
                        borderColor: isToday ? '#22d3ee' : 'transparent',
                        cursor: canClick ? 'pointer' : 'default',
                        opacity: isFuture ? 0.5 : 1
                      }}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs border-2`}
                    >
                      <span className="text-white font-semibold">{day}</span>
                      {isInj && !hasEntry && <span style={{ color: '#cffafe' }} className="text-xs">{dose}U</span>}
                      {isDone && <span style={{ color: '#d1fae5' }} className="text-xs">{entry?.dose}U</span>}
                      {isDone && locationEmoji && <span style={{ fontSize: '10px' }}>{locationEmoji}{sideLabel}</span>}
                      {isDone && doneTime && <span style={{ color: '#d1fae5', fontSize: '9px' }}>{doneTime}</span>}
                      {isMissed && <span style={{ color: '#fbbf24', fontSize: '9px', fontWeight: 'bold' }}>MISS</span>}
                    </button>
                  );
                }

                return cells;
              })()}
            </div>

            {/* Инструкция */}
            <p style={{ color: '#64748b' }} className="text-xs text-center mt-3">
              Натисни върху ден за да логнеш, редактираш или добавиш пропусната инжекция. Точният час подобрява проследяването на протокола.
            </p>
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
          </>
        )}

        {/* PROTOCOL TAB */}
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

            {/* Dose Summary */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-5"
            >
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <div style={{ color: '#64748b' }} className="text-xs mb-1">Доза/инжекция</div>
                  <div style={{ color: '#22d3ee' }} className="text-4xl font-bold">{unitsRounded}U</div>
                </div>
                <div style={{ backgroundColor: '#1e3a5f', width: '1px', height: '50px' }} />
                <div className="text-center flex-1">
                  <div style={{ color: '#64748b' }} className="text-xs mb-1">Активно вещество</div>
                  <div style={{ color: 'white' }} className="text-xl font-bold">{actualDose.toFixed(1)} {compound.unit}</div>
                </div>
                <div style={{ backgroundColor: '#1e3a5f', width: '1px', height: '50px' }} />
                <div className="text-center flex-1">
                  <div style={{ color: '#64748b' }} className="text-xs mb-1">Обем</div>
                  <div style={{ color: 'white' }} className="text-xl font-bold">{actualMl.toFixed(2)} mL</div>
                </div>
              </div>
              {rotation && todayDose !== unitsRounded && (
                <div className="flex items-center justify-center gap-2 mt-3 pt-3">
                  <span className="text-sm">ℹ️</span>
                  <span style={{ color: '#e2e8f0' }} className="text-sm">
                    Оптимизирана доза днес: <span style={{ color: '#22d3ee' }} className="font-bold">{todayDose}U</span> · {((todayDose / 100) * compound.concentration).toFixed(1)} {compound.unit} · {(todayDose / 100).toFixed(2)} mL
                  </span>
                </div>
              )}
            </div>

            {/* Оптимизация на протокола */}
            {(() => {
              const isEOD = proto.frequency === 'EOD';
              const cycleDays = isEOD ? 14 : 7;
              const todayDate = new Date();
              const todayDayOfWeek = todayDate.getDay();
              
              const mondayOfWeek = new Date(todayDate);
              const daysFromMonday = todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1;
              mondayOfWeek.setDate(todayDate.getDate() - daysFromMonday);
              
              const dayNamesShort = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
              
              const cycleData = [];
              for (let i = 0; i < cycleDays; i++) {
                const dayDate = new Date(mondayOfWeek);
                dayDate.setDate(mondayOfWeek.getDate() + i);
                
                const isInjDay = isInjectionDay(dayDate);
                const dose = isInjDay ? (getDoseForDate(dayDate) || unitsRounded) : 0;
                
                const dayKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
                const entry = injections[dayKey];
                const isDone = entry && (entry.status === 'done' || !entry.status);
                const isMissed = entry && entry.status === 'missed';
                const isTodayDay = dayDate.toDateString() === todayDate.toDateString();
                const isFuture = dayDate > todayDate;
                const dayName = dayNamesShort[dayDate.getDay()];
                
                cycleData.push({ dayName, dayDate, dayKey, isInjDay, dose, isDone, isMissed, isToday: isTodayDay, isFuture });
              }
              
              const cycleInjections = cycleData.filter(d => d.isInjDay);
              const cycleTotalMg = cycleInjections.reduce((sum, d) => sum + (d.dose / 100 * compound.concentration), 0);
              const weeklyMg = isEOD ? cycleTotalMg / 2 : cycleTotalMg;
              
              const doseCounts = {};
              cycleInjections.forEach(d => { doseCounts[d.dose] = (doseCounts[d.dose] || 0) + 1; });
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
                        const isPlanned = !day.isDone && !day.isMissed;
                        const showPulse = day.isToday && isPlanned && day.isInjDay;
                        
                        return (
                          <div
                            key={i}
                            style={{ 
                              backgroundColor: 'transparent',
                              border: '1px solid #1e3a5f',
                              borderLeft: day.isDone ? '3px solid #059669' : day.isMissed ? '3px solid #d97706' : '1px solid #1e3a5f',
                              width: '46px',
                              opacity: day.isFuture ? 0.5 : 1,
                              animation: showPulse ? 'pulse 2s infinite' : 'none',
                              boxShadow: showPulse ? '0 0 0 2px rgba(34, 211, 238, 0.4)' : 'none',
                            }}
                            className="py-2 rounded-lg text-center flex-shrink-0"
                          >
                            <div style={{ color: '#94a3b8', fontSize: '10px' }}>{day.dayName}</div>
                            <div style={{ color: '#e2e8f0', fontWeight: 'bold', fontSize: '12px' }}>
                              {day.dose}U
                            </div>
                            {day.isDone && <div style={{ color: '#34d399', fontSize: '12px', lineHeight: 1, marginTop: '-1px' }}>✓</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  <p style={{ color: '#94a3b8' }} className="text-sm text-center mt-2">
                    {doseFormula} = {weeklyMg.toFixed(1)} {compound.unit}/сед
                  </p>
                </div>
              );
            })()}
            
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

            {/* PK Graph - LIVE */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <p style={{ color: '#64748b' }} className="text-sm font-medium mb-3 text-center">
                Относителна концентрация (6 седмици)
              </p>
              
              {/* Current status indicator with toggle */}
              {proto.showNowIndicator !== false && currentStatus ? (
                <div className="mb-3 p-2 rounded-lg relative" style={{ backgroundColor: '#1e293b' }}>
                  <button
                    onClick={() => {
                      const newProfile = {
                        ...profile,
                        protocol: { ...profile.protocol, showNowIndicator: false }
                      };
                      setProfile(newProfile);
                      saveToStorage('thub-profile', newProfile);
                    }}
                    className="absolute top-2 right-2 text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: '#064e3b', color: '#10b981' }}
                  >
                    ON
                  </button>
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
              ) : proto.showNowIndicator === false ? (
                <div className="mb-3 p-2 rounded-lg relative" style={{ backgroundColor: '#1e293b' }}>
                  <button
                    onClick={() => {
                      const newProfile = {
                        ...profile,
                        protocol: { ...profile.protocol, showNowIndicator: true }
                      };
                      setProfile(newProfile);
                      saveToStorage('thub-profile', newProfile);
                    }}
                    className="absolute top-2 right-2 text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: '#1e293b', color: '#64748b', border: '1px solid #334155' }}
                  >
                    OFF
                  </button>
                  <p style={{ color: '#64748b' }} className="text-sm text-center py-1">
                    Live статус изключен
                  </p>
                </div>
              ) : null}
              
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart 
                    data={pkDataMain}
                    margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="pkGradientStats" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="pkBandGradientStats" x1="0" y1="0" x2="0" y2="1">
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
                        return [null, null];
                      }}
                      labelFormatter={(label) => `Ден ${Math.round(label * 10) / 10}`}
                    />
                    <Area 
                      type="natural" 
                      dataKey="percentMax"
                      stroke="none"
                      fill="url(#pkBandGradientStats)"
                      legendType="none"
                    />
                    <Area 
                      type="natural" 
                      dataKey="percent" 
                      stroke="#06b6d4" 
                      strokeWidth={2}
                      fill="url(#pkGradientStats)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              
              <div style={{ color: '#475569' }} className="text-xs text-center mt-2">
                t½ ~{pkParamsMain.halfLife.min.toFixed(1)}-{pkParamsMain.halfLife.max.toFixed(1)}д │ {pkParamsMain.modifiers.method}{pkParamsMain.modifiers.oil ? ` │ ${pkParamsMain.modifiers.oil}` : ''} │ Trough: ~{stabilityDataMain.troughPercent.min}-{stabilityDataMain.troughPercent.max}%
              </div>
            </div>

            {/* Stability Index */}
            {(() => {
              const val = stabilityDataMain.stability.base;
              const valMin = stabilityDataMain.stability.min;
              const valMax = stabilityDataMain.stability.max;

              const cx = 100, cy = 100, r = 80;
              const strokeW = 14;
              const gapDeg = 90;
              const arcDeg = 360 - gapDeg;
              const startDeg = 135;
              const circumference = 2 * Math.PI * r;
              const arcLen = (arcDeg / 360) * circumference;
              const progressLen = (val / 100) * arcLen;

              return (
                <div 
                  style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                  className="border rounded-2xl p-6"
                >
                  <div className="flex flex-col items-center">
                    <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">
                      Индекс на стабилност
                    </label>

                    <div className="relative" style={{ width: '180px', height: '180px' }}>
                      <svg viewBox="0 0 200 200" className="w-full h-full">
                        <defs>
                          <filter id="arcGlowStats">
                            <feGaussianBlur stdDeviation="6" result="blur" />
                            <feMerge>
                              <feMergeNode in="blur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                          <linearGradient id="arcGradStats" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" />
                            <stop offset="100%" stopColor="#22d3ee" />
                          </linearGradient>
                        </defs>

                        <circle
                          cx={cx} cy={cy} r={r}
                          fill="none"
                          stroke="#1e293b"
                          strokeWidth={strokeW}
                          strokeLinecap="round"
                          strokeDasharray={`${arcLen} ${circumference}`}
                          strokeDashoffset={0}
                          transform={`rotate(${startDeg} ${cx} ${cy})`}
                        />

                        <circle
                          cx={cx} cy={cy} r={r}
                          fill="none"
                          stroke="url(#arcGradStats)"
                          strokeWidth={strokeW}
                          strokeLinecap="round"
                          strokeDasharray={`${progressLen} ${circumference}`}
                          strokeDashoffset={0}
                          transform={`rotate(${startDeg} ${cx} ${cy})`}
                          filter="url(#arcGlowStats)"
                        />
                      </svg>

                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span 
                          className="text-2xl font-bold"
                          style={{ color: '#e2e8f0' }}
                        >
                          ~{valMin}-{valMax}%
                        </span>
                      </div>
                    </div>

                    <div className="w-full grid grid-cols-2 gap-3 mt-3">
                      <div 
                        style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                        className="border rounded-xl p-3 text-center"
                      >
                        <div style={{ color: '#64748b' }} className="text-sm font-medium mb-1">Ниво преди следваща доза</div>
                        <div style={{ color: '#e2e8f0' }} className="text-lg font-bold">~{stabilityDataMain.troughPercent.min}-{stabilityDataMain.troughPercent.max}%</div>
                        <div style={{ color: '#64748b' }} className="text-xs">от peak</div>
                      </div>
                      <div 
                        style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                        className="border rounded-xl p-3 text-center"
                      >
                        <div style={{ color: '#64748b' }} className="text-sm font-medium mb-1">Амплитуда на нивата</div>
                        <div style={{ color: '#e2e8f0' }} className="text-lg font-bold">~{stabilityDataMain.fluctuation.min}-{stabilityDataMain.fluctuation.max}%</div>
                        <div style={{ color: '#64748b' }} className="text-xs">peak → trough</div>
                      </div>
                    </div>

                    <p style={{ color: '#334155' }} className="text-xs text-center mt-3">
                      Базирано на средни фармакокинетични данни. Индивидуалната реакция варира.
                    </p>
                  </div>
                </div>
              );
            })()}

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
                      {entry.effectiveFrom && (
                        <p style={{ color: '#f59e0b' }} className="text-xs mb-1">
                          Важи от: {new Date(entry.effectiveFrom).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {entry.effectiveMethod && <span style={{ color: '#64748b' }}> ({entry.effectiveMethod})</span>}
                        </p>
                      )}
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
              onClick={async () => { await authSignOut(); setUserId(null); setCurrentStep('onboarding'); }}
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

      {/* Log Injection Modal - Global */}
      {showLogModal && (
        <div 
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="w-full max-w-sm border rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-white text-xl font-bold text-center mb-4">💉 Инжекция</h3>

            {/* Status Selector */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={() => setLogStatus('done')}
                style={{ 
                  backgroundColor: logStatus === 'done' ? '#059669' : '#0a1628',
                  borderColor: logStatus === 'done' ? '#059669' : '#1e3a5f'
                }}
                className="py-3 border rounded-xl text-white font-medium text-sm"
              >
                ✅ Направена
              </button>
              <button
                onClick={() => setLogStatus('missed')}
                style={{ 
                  backgroundColor: logStatus === 'missed' ? '#d97706' : '#0a1628',
                  borderColor: logStatus === 'missed' ? '#d97706' : '#1e3a5f'
                }}
                className="py-3 border rounded-xl text-white font-medium text-sm"
              >
                ⚠️ Пропусната
              </button>
            </div>

            {logStatus === 'done' ? (
              <>
                {/* Time Picker */}
                <div className="mb-4">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Час на инжекция</label>
                  <input
                    type="time"
                    value={logTime}
                    onChange={(e) => setLogTime(e.target.value)}
                    style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                    className="w-full p-3 border rounded-xl text-center text-lg"
                  />
                </div>

                {/* Location */}
                <div className="mb-4">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Локация</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'delt', label: '💪 Делтоид' },
                      { id: 'quad', label: '🦵 Бедро' },
                      { id: 'glute', label: '🍑 Глутеус' },
                      { id: 'abdomen', label: '⭕ Корем' }
                    ].map(loc => (
                      <button
                        key={loc.id}
                        onClick={() => setLogLocation(loc.id)}
                        style={{ 
                          backgroundColor: logLocation === loc.id ? '#0891b2' : '#0a1628',
                          borderColor: logLocation === loc.id ? '#0891b2' : '#1e3a5f'
                        }}
                        className="py-2 border rounded-xl text-white text-sm"
                      >
                        {loc.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Side */}
                <div className="mb-4">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Страна</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setLogSide('left')}
                      style={{ 
                        backgroundColor: logSide === 'left' ? '#0891b2' : '#0a1628',
                        borderColor: logSide === 'left' ? '#0891b2' : '#1e3a5f'
                      }}
                      className="py-3 border rounded-xl text-white font-medium"
                    >
                      Ляво
                    </button>
                    <button
                      onClick={() => setLogSide('right')}
                      style={{ 
                        backgroundColor: logSide === 'right' ? '#0891b2' : '#0a1628',
                        borderColor: logSide === 'right' ? '#0891b2' : '#1e3a5f'
                      }}
                      className="py-3 border rounded-xl text-white font-medium"
                    >
                      Дясно
                    </button>
                  </div>
                </div>

                {/* Dose */}
                <div className="mb-4">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Доза (единици)</label>
                  <input
                    type="number"
                    value={logDose}
                    onChange={(e) => setLogDose(Number(e.target.value))}
                    style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                    className="w-full p-3 border rounded-xl text-center text-lg"
                  />
                </div>

                {/* Note */}
                <div className="mb-5">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Бележка (опционално)</label>
                  <input
                    type="text"
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    placeholder="PIP, синина, сменен флакон..."
                    style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                    className="w-full p-3 border rounded-xl text-sm placeholder-slate-500"
                  />
                </div>
              </>
            ) : (
              <>
                {/* Miss Reason */}
                <div className="mb-4">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Причина</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'forgot', label: 'Забравих' },
                      { id: 'no_access', label: 'Нямах достъп' },
                      { id: 'sick', label: 'Болен' },
                      { id: 'other', label: 'Друга' }
                    ].map(r => (
                      <button
                        key={r.id}
                        onClick={() => setLogMissReason(r.id)}
                        style={{ 
                          backgroundColor: logMissReason === r.id ? '#d97706' : '#0a1628',
                          borderColor: logMissReason === r.id ? '#d97706' : '#1e3a5f'
                        }}
                        className="py-2 border rounded-xl text-white text-sm"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Note */}
                <div className="mb-5">
                  <label style={{ color: '#94a3b8' }} className="block text-sm mb-2">Бележка (опционално)</label>
                  <input
                    type="text"
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    placeholder="Допълнителна информация..."
                    style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                    className="w-full p-3 border rounded-xl text-sm placeholder-slate-500"
                  />
                </div>
              </>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLogModal(false);
                  setPendingLogDay(null);
                }}
                style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}
                className="flex-1 py-3 rounded-xl font-medium"
              >
                Отказ
              </button>
              {pendingLogDay && injections[pendingLogDay] && (
                <button
                  onClick={() => {
                    removeLoggedInjection(pendingLogDay);
                    setShowLogModal(false);
                    setPendingLogDay(null);
                  }}
                  style={{ backgroundColor: '#7f1d1d', color: '#fca5a5' }}
                  className="py-3 px-4 rounded-xl font-medium"
                >
                  🗑️
                </button>
              )}
              <button
                onClick={saveLoggedInjection}
                style={{ background: logStatus === 'done' 
                  ? 'linear-gradient(90deg, #06b6d4, #14b8a6)' 
                  : 'linear-gradient(90deg, #d97706, #f59e0b)' 
                }}
                className="flex-1 py-3 rounded-xl text-white font-medium"
              >
                {logStatus === 'done' ? '✓ Запиши' : '⚠️ Маркирай'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav 
        style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
        className="fixed bottom-0 left-0 right-0 border-t px-2 py-2 flex justify-around"
      >
        {[
          { id: 'today', icon: '🏠', label: 'Днес' },
          { id: 'calendar', icon: '📅', label: 'Календар' },
          { id: 'stats', icon: '📋', label: 'Протокол' },
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

const THUBAppWithErrorBoundary = () => (
  <ErrorBoundary>
    <THUBApp />
  </ErrorBoundary>
);

export default THUBAppWithErrorBoundary;
