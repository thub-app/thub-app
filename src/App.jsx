import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from './supabaseClient';

const THUBApp = () => {
  // ============ STORAGE (localStorage for local/production) ============
  const STORAGE_KEY = 'thub-profile'; // UNIFIED KEY - no email suffix!
  
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
        saveToStorage(STORAGE_KEY, saved);
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
      
      const daysToSteadyState = 35;
      const pointsPerDay = 24;
      let peak = 0;
      let trough = Infinity;
      
      for (let i = 0; i <= daysToSteadyState * pointsPerDay; i++) {
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
        
        if (t >= 28) {
          peak = Math.max(peak, concentration);
          trough = Math.min(trough, concentration);
        }
      }
      
      const fluctuation = peak > 0 ? ((peak - trough) / peak) * 100 : 0;
      return { fluctuation, peak, trough };
    };

    const base = calculateForParams(pkParams.halfLife.base, pkParams.tmax.base, pkParams.bioavailability);
    const min = calculateForParams(pkParams.halfLife.min, pkParams.tmax.min, pkParams.bioavailability);
    const max = calculateForParams(pkParams.halfLife.max, pkParams.tmax.max, pkParams.bioavailability);
    
    return {
      fluctuation: base.fluctuation,
      range: {
        min: min.fluctuation,
        max: max.fluctuation,
      }
    };
  };

  // ============ STATE ============
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState('loading');
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('today');
  const [injections, setInjections] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditingProtocol, setIsEditingProtocol] = useState(false);
  const [editReason, setEditReason] = useState('');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authError, setAuthError] = useState('');

  // Protocol form states
  const [selectedCompound, setSelectedCompound] = useState('test_e_250');
  const [weeklyDose, setWeeklyDose] = useState(250);
  const [frequency, setFrequency] = useState('E3.5D');
  const [graduation, setGraduation] = useState(1);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [source, setSource] = useState('pharmacy');
  const [oilType, setOilType] = useState('grape_seed');
  const [injectionMethod, setInjectionMethod] = useState('im');
  const [injectionSite, setInjectionSite] = useState('delt');

  // Compounds database
  const compounds = {
    'test_e_250': { id: 'test_e_250', name: 'Testosterone Enanthate', shortName: 'Test E', concentration: 250, unit: 'mg', ester: 'test_e' },
    'test_e_200': { id: 'test_e_200', name: 'Testosterone Enanthate', shortName: 'Test E', concentration: 200, unit: 'mg', ester: 'test_e' },
    'test_c_250': { id: 'test_c_250', name: 'Testosterone Cypionate', shortName: 'Test C', concentration: 250, unit: 'mg', ester: 'test_c' },
    'test_c_200': { id: 'test_c_200', name: 'Testosterone Cypionate', shortName: 'Test C', concentration: 200, unit: 'mg', ester: 'test_c' },
    'test_p_100': { id: 'test_p_100', name: 'Testosterone Propionate', shortName: 'Test P', concentration: 100, unit: 'mg', ester: 'test_p' },
    'hcg_5000': { id: 'hcg_5000', name: 'HCG', shortName: 'HCG', concentration: 5000, unit: 'IU', ester: 'hcg' },
  };

  const frequencies = {
    'ED': { id: 'ED', name: 'Всеки ден (ED)', injectionsPerWeek: 7 },
    'EOD': { id: 'EOD', name: 'През ден (EOD)', injectionsPerWeek: 3.5 },
    '3xW': { id: '3xW', name: '3x седмично', injectionsPerWeek: 3 },
    'E3.5D': { id: 'E3.5D', name: '2x седмично (E3.5D)', injectionsPerWeek: 2 },
  };

  // ============ DEMO MODE ============
  const loadDemoProfile = () => {
    const demoProfile = {
      email: 'demo@thub.app',
      name: 'Demo User',
      isDemo: true,
      protocol: {
        compound: 'test_e_250',
        weeklyDose: 200,
        frequency: 'E3.5D',
        graduation: 1,
        startDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: 'pharmacy',
        oilType: 'grape_seed',
        injectionMethod: 'subq',
        injectionSite: 'abdomen',
      },
      protocolHistory: [
        {
          date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
          changes: 'Начален протокол',
          reason: 'Старт на TRT'
        }
      ],
    };

    const demoInjections = {};
    const startDate = new Date(demoProfile.protocol.startDate);
    const today = new Date();
    const injectionInterval = 3.5;
    let currentDate = new Date(startDate);
    
    while (currentDate <= today) {
      const dateKey = currentDate.toISOString().split('T')[0];
      demoInjections[dateKey] = {
        date: dateKey,
        completed: currentDate < today,
        time: '09:00',
        notes: '',
      };
      currentDate = new Date(currentDate.getTime() + injectionInterval * 24 * 60 * 60 * 1000);
    }

    setProfile(demoProfile);
    setInjections(demoInjections);
    setCurrentStep('main');
    setIsLoading(false);
  };

  // ============ SUPABASE SESSION MANAGEMENT ============
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        // Check for existing session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) throw error;

        if (session?.user && mounted) {
          // User is logged in - load their profile
          const saved = loadFromStorage(STORAGE_KEY);
          
          if (saved && saved.email === session.user.email) {
            // Profile exists and matches session
            const migrated = migrateProfile(saved);
            setProfile(migrated);
            setInjections(migrated.injections || {});
            setCurrentStep('main');
          } else {
            // No profile or email mismatch - show protocol setup
            setProfile({ email: session.user.email, name: session.user.email.split('@')[0] });
            setCurrentStep('protocol');
          }
        } else {
          // No session - show auth screen
          setCurrentStep('auth');
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        setCurrentStep('auth');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        const saved = loadFromStorage(STORAGE_KEY);
        
        if (saved && saved.email === session.user.email) {
          setProfile(saved);
          setInjections(saved.injections || {});
          setCurrentStep('main');
        } else {
          setProfile({ email: session.user.email, name: session.user.email.split('@')[0] });
          setCurrentStep('protocol');
        }
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        setInjections({});
        setCurrentStep('auth');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Update current time every minute for real-time NOW indicator
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // Save profile to storage whenever it changes
  useEffect(() => {
    if (profile && !profile.isDemo && profile.protocol) {
      saveToStorage(STORAGE_KEY, { ...profile, injections });
    }
  }, [profile, injections]);

  // ============ AUTH HANDLERS ============
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsLoading(true);

    try {
      if (authMode === 'signup') {
        // Sign up new user
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name }
          }
        });

        if (error) throw error;

        if (data.user) {
          // Create new profile
          const newProfile = {
            email: data.user.email,
            name: name || data.user.email.split('@')[0],
            protocol: null,
            protocolHistory: [],
          };
          
          setProfile(newProfile);
          saveToStorage(STORAGE_KEY, newProfile);
          setCurrentStep('protocol');
        }
      } else {
        // Login existing user
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.user) {
          // Load existing profile
          const saved = loadFromStorage(STORAGE_KEY);
          
          if (saved && saved.email === data.user.email) {
            const migrated = migrateProfile(saved);
            setProfile(migrated);
            setInjections(migrated.injections || {});
            setCurrentStep('main');
          } else {
            // Profile not found - setup protocol
            setProfile({ 
              email: data.user.email, 
              name: data.user.user_metadata?.name || data.user.email.split('@')[0] 
            });
            setCurrentStep('protocol');
          }
        }
      }
    } catch (error) {
      console.error('Auth error:', error);
      setAuthError(error.message || 'Грешка при автентикация');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem(STORAGE_KEY);
      setProfile(null);
      setInjections({});
      setCurrentStep('auth');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const resetApp = () => {
    if (window.confirm('Сигурен ли си? Всички данни ще бъдат изтрити!')) {
      localStorage.clear();
      setProfile(null);
      setInjections({});
      setCurrentStep('auth');
    }
  };

  // ============ PROTOCOL HANDLERS ============
  const saveProtocol = () => {
    const compound = compounds[selectedCompound];
    const freq = frequencies[frequency];
    const dosePerInjection = weeklyDose / freq.injectionsPerWeek;
    const volumeMl = dosePerInjection / compound.concentration;

    const newProtocol = {
      compound: selectedCompound,
      weeklyDose,
      frequency,
      graduation,
      startDate,
      source,
      oilType,
      injectionMethod,
      injectionSite,
      volumeMl,
    };

    let changes = '';
    let isNewProtocol = !profile.protocol;

    if (!isNewProtocol) {
      const old = profile.protocol;
      const changesArr = [];
      
      if (old.compound !== selectedCompound) {
        const oldC = compounds[old.compound];
        changesArr.push(`Препарат: ${oldC.shortName} → ${compound.shortName}`);
      }
      if (old.weeklyDose !== weeklyDose) {
        changesArr.push(`Седмична доза: ${old.weeklyDose} → ${weeklyDose} ${compound.unit}`);
      }
      if (old.frequency !== frequency) {
        const oldF = frequencies[old.frequency];
        changesArr.push(`Честота: ${oldF.name} → ${freq.name}`);
      }
      if (old.source !== source) {
        const sourceMap = { pharmacy: 'Аптека', ugl: 'UGL', unknown: 'Не знам' };
        changesArr.push(`Източник: ${sourceMap[old.source]} → ${sourceMap[source]}`);
      }
      if (old.oilType !== oilType) {
        changesArr.push(`Масло: ${old.oilType} → ${oilType}`);
      }
      if (old.injectionMethod !== injectionMethod) {
        changesArr.push(`Метод: ${old.injectionMethod.toUpperCase()} → ${injectionMethod.toUpperCase()}`);
      }
      
      changes = changesArr.join(', ');
    }

    const updatedProfile = {
      ...profile,
      protocol: newProtocol,
      protocolHistory: [
        ...(profile.protocolHistory || []),
        {
          date: new Date().toISOString(),
          changes: isNewProtocol ? 'Начален протокол' : changes,
          reason: isNewProtocol ? 'Старт на протокол' : (editReason || 'Промяна в протокола'),
        }
      ]
    };

    setProfile(updatedProfile);
    
    if (!profile.isDemo) {
      saveToStorage(STORAGE_KEY, { ...updatedProfile, injections });
    }

    // Generate injection schedule
    generateInjectionSchedule(newProtocol);
    
    setCurrentStep('main');
    setIsEditingProtocol(false);
    setEditReason('');
  };

  const generateInjectionSchedule = (protocol) => {
    const newInjections = {};
    const start = new Date(protocol.startDate);
    const today = new Date();
    const endDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const injectionInterval = protocol.frequency === 'ED' ? 1 : 
                             protocol.frequency === 'EOD' ? 2 : 
                             protocol.frequency === '3xW' ? 7/3 : 3.5;
    
    let currentDate = new Date(start);
    
    while (currentDate <= endDate) {
      const dateKey = currentDate.toISOString().split('T')[0];
      newInjections[dateKey] = {
        date: dateKey,
        completed: currentDate < today,
        time: '09:00',
        notes: '',
      };
      currentDate = new Date(currentDate.getTime() + injectionInterval * 24 * 60 * 60 * 1000);
    }
    
    setInjections(newInjections);
  };

  const toggleInjection = (dateKey) => {
    const updated = {
      ...injections,
      [dateKey]: {
        ...injections[dateKey],
        completed: !injections[dateKey].completed,
      }
    };
    setInjections(updated);
  };

  const addNote = (dateKey, notes) => {
    const updated = {
      ...injections,
      [dateKey]: {
        ...injections[dateKey],
        notes,
      }
    };
    setInjections(updated);
  };

  // ============ RENDER HELPERS ============
  const getTodayInjection = () => {
    const today = new Date().toISOString().split('T')[0];
    return injections[today];
  };

  const getNextInjection = () => {
    const today = new Date();
    const futureInjections = Object.values(injections)
      .filter(inj => new Date(inj.date) > today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return futureInjections[0];
  };

  const getDaysUntilNext = () => {
    const next = getNextInjection();
    if (!next) return null;
    const today = new Date();
    const nextDate = new Date(next.date);
    const diffTime = nextDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Calculate current concentration percentage based on PK model
  const getCurrentConcentration = () => {
    if (!profile?.protocol) return { percent: 0, trend: 'stable' };

    const proto = profile.protocol;
    const compound = compounds[proto.compound];
    const freq = frequencies[proto.frequency];
    const dosePerInjection = proto.weeklyDose / freq.injectionsPerWeek;

    // Get PK parameters
    const pkParams = getPkParameters(
      proto.compound,
      proto.injectionMethod || 'im',
      proto.oilType || 'grape_seed',
      proto.injectionSite || 'delt',
      proto.volumeMl || 1.0
    );

    // Calculate time since last injection
    const today = new Date();
    const pastInjections = Object.values(injections)
      .filter(inj => inj.completed && new Date(inj.date) <= today)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (pastInjections.length === 0) {
      return { percent: 0, trend: 'stable' };
    }

    const lastInj = pastInjections[0];
    const timeSinceLastInj = (today - new Date(lastInj.date)) / (1000 * 60 * 60 * 24); // days

    // Calculate current concentration using PK model
    const ka = Math.log(2) / (pkParams.tmax.base / 3);
    const ke = Math.log(2) / pkParams.halfLife.base;
    const bio = pkParams.bioavailability;

    let currentConc = 0;
    for (const inj of pastInjections.slice(0, 10)) { // Last 10 injections
      const timeSince = (today - new Date(inj.date)) / (1000 * 60 * 60 * 24);
      if (timeSince < 30) { // Only count recent injections
        const d = dosePerInjection * bio;
        const c = d * (ka / (ka - ke)) * (Math.exp(-ke * timeSince) - Math.exp(-ka * timeSince));
        currentConc += Math.max(0, c);
      }
    }

    // Find steady-state peak for normalization
    const pkData = generatePkData(pkParams, dosePerInjection, proto.frequency);
    const steadyStateData = pkData.filter(d => d.day >= 28);
    const peakPercent = Math.max(...steadyStateData.map(d => d.percent));

    // Normalize current concentration to percentage
    const normalizedPercent = peakPercent > 0 ? (currentConc / (peakPercent / 100)) : 0;

    // Determine trend
    let trend = 'stable';
    const nextInj = getNextInjection();
    if (nextInj) {
      const daysUntilNext = (new Date(nextInj.date) - today) / (1000 * 60 * 60 * 24);
      if (daysUntilNext <= 1) {
        trend = 'rising'; // About to inject
      } else if (timeSinceLastInj > 1) {
        trend = 'falling'; // Been a while since last injection
      }
    }

    return {
      percent: Math.max(0, Math.min(100, normalizedPercent)),
      trend,
    };
  };

  // ============ LOADING SCREEN ============
  if (isLoading) {
    return (
      <div 
        style={{ backgroundColor: '#020617' }}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="text-center">
          <div className="text-6xl mb-4">💉</div>
          <p style={{ color: '#22d3ee' }} className="text-xl font-bold">THUB</p>
          <p style={{ color: '#64748b' }} className="text-sm mt-2">Зареждане...</p>
        </div>
      </div>
    );
  }

  // ============ AUTH SCREEN ============
  if (currentStep === 'auth') {
    return (
      <div 
        style={{ backgroundColor: '#020617' }}
        className="min-h-screen flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">💉</div>
            <h1 style={{ color: '#22d3ee' }} className="text-3xl font-bold mb-2">THUB</h1>
            <p style={{ color: '#64748b' }} className="text-sm">TRT Protocol Management</p>
          </div>

          <div 
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="border rounded-2xl p-6 mb-4"
          >
            <div className="flex mb-6">
              <button
                onClick={() => setAuthMode('login')}
                className="flex-1 py-2 rounded-lg transition-all"
                style={{
                  backgroundColor: authMode === 'login' ? '#1e3a5f' : 'transparent',
                  color: authMode === 'login' ? '#22d3ee' : '#64748b',
                }}
              >
                Вход
              </button>
              <button
                onClick={() => setAuthMode('signup')}
                className="flex-1 py-2 rounded-lg transition-all"
                style={{
                  backgroundColor: authMode === 'signup' ? '#1e3a5f' : 'transparent',
                  color: authMode === 'signup' ? '#22d3ee' : '#64748b',
                }}
              >
                Регистрация
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === 'signup' && (
                <div>
                  <label style={{ color: '#64748b' }} className="block text-sm mb-2">Име</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                    className="w-full border rounded-lg p-3 text-white"
                    placeholder="Твоето име"
                    required={authMode === 'signup'}
                  />
                </div>
              )}

              <div>
                <label style={{ color: '#64748b' }} className="block text-sm mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                  className="w-full border rounded-lg p-3 text-white"
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <label style={{ color: '#64748b' }} className="block text-sm mb-2">Парола</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                  className="w-full border rounded-lg p-3 text-white"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {authError && (
                <div 
                  style={{ backgroundColor: '#7f1d1d', borderColor: '#991b1b' }}
                  className="border rounded-lg p-3"
                >
                  <p className="text-red-300 text-sm">{authError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                style={{ backgroundColor: '#22d3ee' }}
                className="w-full py-3 rounded-lg text-black font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {authMode === 'login' ? 'Вход' : 'Регистрация'}
              </button>
            </form>
          </div>

          <button
            onClick={loadDemoProfile}
            style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
            className="w-full border rounded-2xl p-4 text-white hover:border-cyan-400 transition-colors"
          >
            <span className="text-2xl mb-2 block">🎮</span>
            <span className="font-bold">Demo режим</span>
            <p style={{ color: '#64748b' }} className="text-xs mt-1">
              Тествай без регистрация
            </p>
          </button>
        </div>
      </div>
    );
  }

  // ============ PROTOCOL SETUP ============
  if (currentStep === 'protocol') {
    const compound = compounds[selectedCompound];
    const freq = frequencies[frequency];
    const dosePerInjection = weeklyDose / freq.injectionsPerWeek;
    const volumeMl = dosePerInjection / compound.concentration;
    const unitsRaw = (volumeMl / 0.01) * graduation;

    return (
      <div 
        style={{ backgroundColor: '#020617' }}
        className="min-h-screen p-4"
      >
        <div className="max-w-2xl mx-auto py-8">
          <div className="mb-8">
            <h1 style={{ color: '#22d3ee' }} className="text-2xl font-bold mb-2">
              {isEditingProtocol ? '✏️ Редактиране на протокол' : '⚙️ Настройка на протокол'}
            </h1>
            <p style={{ color: '#64748b' }} className="text-sm">
              {isEditingProtocol ? 'Промени настройките и запиши' : 'Въведи параметрите на твоя TRT протокол'}
            </p>
          </div>

          <div className="space-y-4">
            {/* Compound */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Препарат</label>
              <select
                value={selectedCompound}
                onChange={(e) => setSelectedCompound(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                {Object.values(compounds).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.shortName} {c.concentration}{c.unit}/ml
                  </option>
                ))}
              </select>
            </div>

            {/* Weekly Dose */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">
                Седмична доза ({compound.unit})
              </label>
              <input
                type="number"
                value={weeklyDose}
                onChange={(e) => setWeeklyDose(Number(e.target.value))}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
                min="50"
                max="1000"
                step="25"
              />
            </div>

            {/* Frequency */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Честота</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                {Object.values(frequencies).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Syringe Graduation */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Скала на спринцовката</label>
              <select
                value={graduation}
                onChange={(e) => setGraduation(Number(e.target.value))}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                <option value={1}>1U = 0.01ml (0-50U)</option>
                <option value={2}>2U = 0.01ml (0-100U)</option>
              </select>
            </div>

            {/* Start Date */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Начална дата</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              />
            </div>

            {/* Source */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Източник</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                <option value="pharmacy">🏥 Аптека</option>
                <option value="ugl">🧪 UGL</option>
                <option value="unknown">❓ Не знам</option>
              </select>
            </div>

            {/* Oil Type */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Вид масло</label>
              <select
                value={oilType}
                onChange={(e) => setOilType(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                <option value="mct">MCT (бързо)</option>
                <option value="grape_seed">Grape Seed (стандарт)</option>
                <option value="sesame">Sesame (бавно)</option>
                <option value="castor">Castor (много бавно)</option>
                <option value="other">Друго</option>
                <option value="unknown">Не знам</option>
              </select>
            </div>

            {/* Injection Method */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Метод на инжектиране</label>
              <select
                value={injectionMethod}
                onChange={(e) => setInjectionMethod(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                <option value="im">💉 IM (интрамускулно)</option>
                <option value="subq">💧 SubQ (подкожно)</option>
              </select>
            </div>

            {/* Injection Site */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <label style={{ color: '#64748b' }} className="block text-sm mb-2">Основна локация</label>
              <select
                value={injectionSite}
                onChange={(e) => setInjectionSite(e.target.value)}
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="w-full border rounded-lg p-3 text-white"
              >
                <option value="delt">Рамо (Deltoid)</option>
                <option value="glute">Задник (Glute)</option>
                <option value="quad">Крак (Quad)</option>
                <option value="abdomen">Корем (Abdomen - SubQ)</option>
              </select>
            </div>

            {/* Calculated Dose */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <div className="flex justify-between items-center mb-2">
                <span style={{ color: '#64748b' }} className="text-sm">Доза на инжекция</span>
                <span style={{ color: '#22d3ee' }} className="text-xl font-bold">
                  {unitsRaw.toFixed(1)}U
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: '#64748b' }} className="text-sm">Обем</span>
                <span className="text-white text-sm">
                  {volumeMl.toFixed(2)}ml ({dosePerInjection.toFixed(1)} {compound.unit})
                </span>
              </div>
            </div>

            {/* Edit Reason (only when editing) */}
            {isEditingProtocol && (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4"
              >
                <label style={{ color: '#64748b' }} className="block text-sm mb-2">
                  Причина за промяна
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                  className="w-full border rounded-lg p-3 text-white"
                  placeholder="напр. Промяна на доза след кръвни изследвания"
                />
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={saveProtocol}
              style={{ backgroundColor: '#22d3ee' }}
              className="w-full py-4 rounded-2xl text-black font-bold text-lg"
            >
              💾 {isEditingProtocol ? 'Запази промените' : 'Запази протокол'}
            </button>

            {isEditingProtocol && (
              <button
                onClick={() => {
                  setIsEditingProtocol(false);
                  setEditReason('');
                  setCurrentStep('main');
                }}
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="w-full border rounded-2xl py-3 text-white"
              >
                Отказ
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN APP ============
  const proto = profile.protocol;
  const compound = compounds[proto.compound];
  const freq = frequencies[proto.frequency];
  const dosePerInjection = proto.weeklyDose / freq.injectionsPerWeek;
  const volumeMl = dosePerInjection / compound.concentration;
  const unitsRaw = (volumeMl / 0.01) * proto.graduation;
  const todayInj = getTodayInjection();
  const nextInj = getNextInjection();
  const daysUntilNext = getDaysUntilNext();

  // Get PK parameters for current protocol
  const pkParams = getPkParameters(
    proto.compound,
    proto.injectionMethod || 'im',
    proto.oilType || 'grape_seed',
    proto.injectionSite || 'delt',
    volumeMl
  );

  // Generate PK data
  const pkData = generatePkData(pkParams, dosePerInjection, proto.frequency, 42, true);
  
  // Calculate stability
  const stability = calculateStabilityWithRange(pkParams, dosePerInjection, proto.frequency);

  // Get current concentration for live indicator
  const currentConc = getCurrentConcentration();

  return (
    <div 
      style={{ backgroundColor: '#020617' }}
      className="min-h-screen pb-20"
    >
      {/* Header */}
      <header 
        style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
        className="border-b px-4 py-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">💉</div>
            <div>
              <h1 style={{ color: '#22d3ee' }} className="text-xl font-bold">THUB</h1>
              <p style={{ color: '#64748b' }} className="text-xs">
                {profile.isDemo ? '🎮 Demo' : profile.name}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p style={{ color: '#64748b' }} className="text-xs">
              {currentTime.toLocaleDateString('bg-BG', { weekday: 'short' })}
            </p>
            <p className="text-white text-sm font-bold">
              {currentTime.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 space-y-4">
        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div className="space-y-4">
            {/* Today's Injection Card */}
            {todayInj ? (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-bold text-lg">Днес</h2>
                  <span style={{ color: '#22d3ee' }} className="text-sm">
                    {new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })}
                  </span>
                </div>

                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p style={{ color: '#64748b' }} className="text-sm mb-1">Доза</p>
                    <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">
                      {unitsRaw.toFixed(1)}U
                    </p>
                    <p style={{ color: '#64748b' }} className="text-xs mt-1">
                      {volumeMl.toFixed(2)}ml • {dosePerInjection.toFixed(1)} {compound.unit}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleInjection(todayInj.date)}
                    className="w-20 h-20 rounded-full flex items-center justify-center transition-all"
                    style={{
                      backgroundColor: todayInj.completed ? '#22d3ee' : '#1e3a5f',
                      color: todayInj.completed ? '#020617' : '#64748b',
                    }}
                  >
                    <span className="text-3xl">{todayInj.completed ? '✓' : '○'}</span>
                  </button>
                </div>

                <div 
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                  className="border rounded-xl p-3"
                >
                  <p style={{ color: '#64748b' }} className="text-xs mb-2">Бележка</p>
                  <input
                    type="text"
                    value={todayInj.notes || ''}
                    onChange={(e) => addNote(todayInj.date, e.target.value)}
                    placeholder="Добави бележка..."
                    style={{ backgroundColor: 'transparent', color: '#ffffff' }}
                    className="w-full text-sm outline-none"
                  />
                </div>
              </div>
            ) : (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-8 text-center"
              >
                <p className="text-4xl mb-2">✓</p>
                <p className="text-white font-bold">Няма инжекция днес</p>
                <p style={{ color: '#64748b' }} className="text-sm mt-2">
                  {nextInj && `Следваща: след ${daysUntilNext} дни`}
                </p>
              </div>
            )}

            {/* Next Injection */}
            {nextInj && (
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4"
              >
                <h3 className="text-white font-bold mb-3">Следваща инжекция</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p style={{ color: '#22d3ee' }} className="text-xl font-bold">
                      {new Date(nextInj.date).toLocaleDateString('bg-BG', { 
                        day: 'numeric', 
                        month: 'long',
                        weekday: 'short'
                      })}
                    </p>
                    <p style={{ color: '#64748b' }} className="text-sm mt-1">
                      След {daysUntilNext} {daysUntilNext === 1 ? 'ден' : 'дни'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p style={{ color: '#22d3ee' }} className="text-2xl font-bold">
                      {unitsRaw.toFixed(1)}U
                    </p>
                    <p style={{ color: '#64748b' }} className="text-xs">
                      {volumeMl.toFixed(2)}ml
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Current Level Indicator */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <h3 className="text-white font-bold mb-3">Текущо ниво</h3>
              <div className="flex items-center gap-4">
                <div 
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#1e3a5f' }}
                >
                  <span style={{ color: '#22d3ee' }} className="text-xl font-bold">
                    {currentConc.percent.toFixed(0)}%
                  </span>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full transition-all duration-1000"
                      style={{ 
                        width: `${currentConc.percent}%`,
                        backgroundColor: '#22d3ee'
                      }}
                    />
                  </div>
                  <p style={{ color: '#64748b' }} className="text-xs mt-2">
                    {currentConc.trend === 'rising' && '📈 Скоро инжекция'}
                    {currentConc.trend === 'falling' && '📉 Намаляващо'}
                    {currentConc.trend === 'stable' && '➡️ Стабилно'}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div 
                style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
                className="border rounded-2xl p-4 text-center"
              >
                <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">
                  {Object.values(injections).filter(i => i.completed).length}
                </p>
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
          </div>
        )}

        {/* CALENDAR TAB */}
        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <h2 className="text-white font-bold mb-4">Календар на инжекции</h2>
              
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {Object.values(injections)
                  .sort((a, b) => new Date(b.date) - new Date(a.date))
                  .map((inj) => {
                    const injDate = new Date(inj.date);
                    const today = new Date();
                    const isPast = injDate < today;
                    const isToday = injDate.toDateString() === today.toDateString();
                    const isFuture = injDate > today;

                    return (
                      <div
                        key={inj.date}
                        style={{ 
                          backgroundColor: isToday ? '#1e3a5f' : '#0a1628',
                          borderColor: inj.completed ? '#22d3ee' : '#1e3a5f',
                        }}
                        className="border rounded-xl p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleInjection(inj.date)}
                              className="w-8 h-8 rounded-full flex items-center justify-center"
                              style={{
                                backgroundColor: inj.completed ? '#22d3ee' : '#1e3a5f',
                                color: inj.completed ? '#020617' : '#64748b',
                              }}
                            >
                              {inj.completed ? '✓' : '○'}
                            </button>
                            <div>
                              <p className="text-white text-sm font-bold">
                                {injDate.toLocaleDateString('bg-BG', { 
                                  day: 'numeric', 
                                  month: 'long',
                                  weekday: 'short'
                                })}
                                {isToday && <span style={{ color: '#22d3ee' }} className="ml-2">• ДНЕС</span>}
                              </p>
                              <p style={{ color: '#64748b' }} className="text-xs">
                                {unitsRaw.toFixed(1)}U • {volumeMl.toFixed(2)}ml
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            {isFuture && (
                              <span style={{ color: '#64748b' }} className="text-xs">
                                {Math.ceil((injDate - today) / (1000 * 60 * 60 * 24))} дни
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            {/* Edit Button */}
            <button
              onClick={() => {
                setIsEditingProtocol(true);
                setSelectedCompound(proto.compound);
                setWeeklyDose(proto.weeklyDose);
                setFrequency(proto.frequency);
                setGraduation(proto.graduation);
                setStartDate(proto.startDate);
                setSource(proto.source || 'pharmacy');
                setOilType(proto.oilType || 'grape_seed');
                setInjectionMethod(proto.injectionMethod || 'im');
                setInjectionSite(proto.injectionSite || 'delt');
                setCurrentStep('protocol');
              }}
              style={{ backgroundColor: '#22d3ee' }}
              className="w-full py-3 rounded-2xl text-black font-bold"
            >
              ✏️ Редактирай протокол
            </button>

            {/* Stability Gauge */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-6"
            >
              <h3 className="text-white font-bold mb-4 text-center">Индекс на стабилност</h3>
              
              <div className="flex justify-center mb-4">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full -rotate-90">
                    {/* Background circle */}
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      fill="none"
                      stroke="#1e3a5f"
                      strokeWidth="12"
                    />
                    {/* Progress circle */}
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="12"
                      strokeDasharray={`${(100 - stability.fluctuation) * 4.4} 440`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span style={{ color: '#22d3ee' }} className="text-3xl font-bold">
                      {(100 - stability.fluctuation).toFixed(0)}%
                    </span>
                    <span style={{ color: '#64748b' }} className="text-xs">стабилност</span>
                  </div>
                </div>
              </div>

              <div 
                style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }}
                className="border rounded-xl p-3 mb-4"
              >
                <div className="flex justify-between items-center">
                  <span style={{ color: '#64748b' }} className="text-sm">Флуктуация</span>
                  <span className="text-white font-bold">{stability.fluctuation.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span style={{ color: '#64748b' }} className="text-xs">Диапазон</span>
                  <span style={{ color: '#64748b' }} className="text-xs">
                    {stability.range.min.toFixed(1)}% - {stability.range.max.toFixed(1)}%
                  </span>
                </div>
              </div>

              <p style={{ color: '#64748b' }} className="text-xs text-center">
                Стабилността показва колко константно е нивото на тестостерон.<br/>
                По-висока стабилност = по-малко колебания.
              </p>
            </div>

            {/* PK Curve */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <h3 className="text-white font-bold mb-4">Фармакокинетична крива</h3>
              
              {/* Modifiers Display */}
              <div className="flex flex-wrap gap-2 mb-4">
                {pkParams.modifiers.method && (
                  <span 
                    style={{ backgroundColor: '#1e3a5f', color: '#22d3ee' }}
                    className="px-3 py-1 rounded-full text-xs font-semibold"
                  >
                    {pkParams.modifiers.method}
                  </span>
                )}
                {pkParams.modifiers.oil && (
                  <span 
                    style={{ backgroundColor: '#1e3a5f', color: '#22d3ee' }}
                    className="px-3 py-1 rounded-full text-xs font-semibold"
                  >
                    {pkParams.modifiers.oil}
                  </span>
                )}
                {pkParams.modifiers.site && (
                  <span 
                    style={{ backgroundColor: '#1e3a5f', color: '#22d3ee' }}
                    className="px-3 py-1 rounded-full text-xs font-semibold"
                  >
                    {pkParams.modifiers.site.toUpperCase()}
                  </span>
                )}
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pkData}>
                    <defs>
                      <linearGradient id="colorPercent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#64748b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="day" 
                      stroke="#64748b"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      tickFormatter={(day) => `${Math.floor(day)}д`}
                    />
                    <YAxis 
                      stroke="#64748b"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      domain={[0, 100]}
                      tickFormatter={(val) => `${val}%`}
                    />
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: '#0a1628', 
                        border: '1px solid #1e3a5f',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: '#64748b' }}
                      formatter={(value) => [`${value.toFixed(1)}%`, 'Ниво']}
                      labelFormatter={(day) => `Ден ${Math.floor(day)}`}
                    />
                    {/* Uncertainty band */}
                    <Area
                      type="monotone"
                      dataKey="percentMax"
                      stroke="none"
                      fill="url(#bandGradient)"
                    />
                    <Area
                      type="monotone"
                      dataKey="percentMin"
                      stroke="none"
                      fill="#0f172a"
                    />
                    {/* Main curve */}
                    <Area
                      type="monotone"
                      dataKey="percent"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      fill="url(#colorPercent)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <p style={{ color: '#64748b' }} className="text-xs text-center mt-4">
                Нормализирано ниво (0-100%). Графиката показва как се натрупва и намалява тестостеронът.
              </p>
            </div>

            {/* Protocol Details */}
            <div 
              style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }}
              className="border rounded-2xl p-4"
            >
              <h3 className="text-white font-bold mb-4">Детайли на протокола</h3>
              <div className="space-y-2 text-sm">
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
