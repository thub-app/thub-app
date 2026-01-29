import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from './supabaseClient';

const THUBApp = () => {
  // ============ AUTH STATE ============
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('signin');
  const [authError, setAuthError] = useState('');

  // ============ APP STATE ============
  const [currentStep, setCurrentStep] = useState('onboarding');
  const [profile, setProfile] = useState(null);
  const [protocolData, setProtocolData] = useState({
    compound: 'test_e_200',
    weeklyDose: 150,
    frequency: 'EOD',
    graduation: 2,
    startDate: new Date().toISOString().split('T')[0],
    source: 'unknown',
    oilType: 'unknown'
  });
  const [injections, setInjections] = useState({});
  const [activeTab, setActiveTab] = useState('today');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    newsletterConsent: false
  });
  const [errors, setErrors] = useState({});

  // Modal state
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [detectedChanges, setDetectedChanges] = useState([]);
  const [changeReason, setChangeReason] = useState('');

  // ============ AUTH EFFECTS ============
  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        loadUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        loadUserData(session.user.id);
      } else {
        setCurrentStep('onboarding');
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ============ DATA LOADING ============
  const loadUserData = async (userId) => {
    try {
      // Load profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileData) {
        setProfile(profileData);
      }

      // Load active protocol
      const { data: protocolDataDB } = await supabase
        .from('protocols')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (protocolDataDB) {
        setProtocolData({
          id: protocolDataDB.id,
          compound: protocolDataDB.compound,
          weeklyDose: protocolDataDB.weekly_dose,
          frequency: protocolDataDB.frequency,
          graduation: protocolDataDB.graduation,
          startDate: protocolDataDB.start_date,
          source: protocolDataDB.source || 'unknown',
          oilType: protocolDataDB.oil_type || 'unknown'
        });
        setCurrentStep('main');
      } else {
        setCurrentStep('protocol');
      }

      // Load injections
      const { data: injectionsData } = await supabase
        .from('injections')
        .select('*')
        .eq('user_id', userId);

      if (injectionsData) {
        const injectionsMap = {};
        injectionsData.forEach(inj => {
          const date = new Date(inj.date);
          const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          injectionsMap[key] = { time: inj.time?.slice(0, 5), dose: inj.dose_units };
        });
        setInjections(injectionsMap);
      }

    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============ AUTH FUNCTIONS ============
  const handleSignUp = async () => {
    setAuthError('');
    
    // Validation
    if (!formData.name || formData.name.length < 2) {
      setErrors({ name: 'Минимум 2 символа' });
      return;
    }
    if (!formData.email || !formData.email.includes('@')) {
      setErrors({ email: 'Невалиден имейл' });
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      setErrors({ password: 'Минимум 6 символа' });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setErrors({ confirmPassword: 'Паролите не съвпадат' });
      return;
    }

    setLoading(true);
    
    const { data, error } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          name: formData.name
        }
      }
    });

    if (error) {
      setAuthError(error.message);
      setLoading(false);
      return;
    }

    // Update profile with name and newsletter consent
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ 
          name: formData.name,
          newsletter_consent: formData.newsletterConsent 
        })
        .eq('id', data.user.id);
    }

    setLoading(false);
  };

  const handleSignIn = async () => {
    setAuthError('');
    
    if (!formData.email || !formData.password) {
      setAuthError('Въведи имейл и парола');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password
    });

    if (error) {
      setAuthError('Грешен имейл или парола');
      setLoading(false);
      return;
    }

    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setCurrentStep('onboarding');
    setFormData({ name: '', email: '', password: '', confirmPassword: '', newsletterConsent: false });
  };

  // ============ PROTOCOL FUNCTIONS ============
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

  const sourceNames = {
    'pharmacy': 'Аптека',
    'ugl': 'UGL',
    'unknown': 'Не знам'
  };

  const oilNames = {
    'mct': 'MCT Oil',
    'grape_seed': 'Grape Seed Oil',
    'sesame': 'Sesame Oil',
    'castor': 'Castor Oil',
    'other': 'Друго',
    'unknown': 'Не знам'
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
      changes.push({ field: 'Седмична доза', from: `${oldProto.weeklyDose} mg`, to: `${newProto.weeklyDose} mg` });
    }
    
    if (oldProto.frequency !== newProto.frequency) {
      changes.push({
        field: 'Честота',
        from: frequencyNames[oldProto.frequency] || oldProto.frequency,
        to: frequencyNames[newProto.frequency] || newProto.frequency
      });
    }
    
    if (oldProto.graduation !== newProto.graduation) {
      changes.push({ field: 'Скала', from: `${oldProto.graduation}U`, to: `${newProto.graduation}U` });
    }
    
    if (oldProto.startDate !== newProto.startDate) {
      changes.push({ field: 'Начална дата', from: oldProto.startDate, to: newProto.startDate });
    }

    if (oldProto.source !== newProto.source) {
      changes.push({ field: 'Източник', from: sourceNames[oldProto.source], to: sourceNames[newProto.source] });
    }

    if (oldProto.oilType !== newProto.oilType) {
      changes.push({ field: 'Масло', from: oilNames[oldProto.oilType], to: oilNames[newProto.oilType] });
    }
    
    return changes;
  };

  const handleProtocolSubmit = async () => {
    // If editing existing protocol, check for changes
    if (protocolData.id) {
      const { data: oldProtocol } = await supabase
        .from('protocols')
        .select('*')
        .eq('id', protocolData.id)
        .single();

      if (oldProtocol) {
        const oldData = {
          compound: oldProtocol.compound,
          weeklyDose: oldProtocol.weekly_dose,
          frequency: oldProtocol.frequency,
          graduation: oldProtocol.graduation,
          startDate: oldProtocol.start_date,
          source: oldProtocol.source || 'unknown',
          oilType: oldProtocol.oil_type || 'unknown'
        };
        
        const changes = detectProtocolChanges(oldData, protocolData);
        
        if (changes.length > 0) {
          setDetectedChanges(changes);
          setChangeReason('');
          setShowChangeModal(true);
          return;
        }
      }
    }
    
    await saveProtocol();
  };

  const saveProtocol = async (reason = null) => {
    if (!session) return;

    try {
      if (protocolData.id) {
        // Update existing protocol
        await supabase
          .from('protocols')
          .update({
            compound: protocolData.compound,
            weekly_dose: protocolData.weeklyDose,
            frequency: protocolData.frequency,
            graduation: protocolData.graduation,
            start_date: protocolData.startDate,
            source: protocolData.source,
            oil_type: protocolData.oilType,
            updated_at: new Date().toISOString()
          })
          .eq('id', protocolData.id);

        // Save history if there's a reason
        if (reason) {
          await supabase.from('protocol_history').insert({
            user_id: session.user.id,
            protocol_id: protocolData.id,
            changes: detectedChanges.map(c => `${c.field}: ${c.from} → ${c.to}`).join(', '),
            reason: reason
          });
        }
      } else {
        // Deactivate old protocols
        await supabase
          .from('protocols')
          .update({ is_active: false })
          .eq('user_id', session.user.id);

        // Create new protocol
        const { data: newProtocol } = await supabase
          .from('protocols')
          .insert({
            user_id: session.user.id,
            compound: protocolData.compound,
            weekly_dose: protocolData.weeklyDose,
            frequency: protocolData.frequency,
            graduation: protocolData.graduation,
            start_date: protocolData.startDate,
            source: protocolData.source,
            oil_type: protocolData.oilType,
            is_active: true
          })
          .select()
          .single();

        if (newProtocol) {
          setProtocolData(prev => ({ ...prev, id: newProtocol.id }));
        }
      }

      setShowChangeModal(false);
      setDetectedChanges([]);
      setChangeReason('');
      setActiveTab('today');
      setCurrentStep('main');
    } catch (error) {
      console.error('Error saving protocol:', error);
    }
  };

  const cancelProtocolChange = () => {
    loadUserData(session.user.id);
    setShowChangeModal(false);
    setDetectedChanges([]);
    setChangeReason('');
  };

  // ============ INJECTION FUNCTIONS ============
  const toggleTodayInjection = async () => {
    if (!session) return;
    
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    if (injections[todayKey]) {
      // Delete injection
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      await supabase
        .from('injections')
        .delete()
        .eq('user_id', session.user.id)
        .eq('date', dateStr);

      setInjections(prev => {
        const newState = { ...prev };
        delete newState[todayKey];
        return newState;
      });
    } else {
      // Add injection
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      await supabase.from('injections').insert({
        user_id: session.user.id,
        protocol_id: protocolData.id,
        date: dateStr,
        time: timeStr + ':00',
        dose_units: todayDose
      });

      setInjections(prev => ({
        ...prev,
        [todayKey]: { time: timeStr, dose: todayDose }
      }));
    }
  };

  // ============ CALCULATIONS ============
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

  const compound = compounds.find(c => c.id === protocolData.compound) || compounds[0];
  const freq = frequenciesData.find(f => f.id === protocolData.frequency) || frequenciesData[1];

  const dosePerInjection = protocolData.weeklyDose / freq.perWeek;
  const mlPerInjection = dosePerInjection / compound.concentration;
  const unitsRaw = mlPerInjection * 100;
  const unitsRounded = Math.round(unitsRaw / protocolData.graduation) * protocolData.graduation;
  const actualMl = unitsRounded / 100;
  const actualDose = actualMl * compound.concentration;
  const actualWeekly = actualDose * freq.perWeek;
  const deltaAbs = actualWeekly - protocolData.weeklyDose;
  const deltaPct = protocolData.weeklyDose > 0 ? deltaAbs / protocolData.weeklyDose : 0;

  // Rotation schedule
  const injectionsPerPeriod = protocolData.frequency === 'EOD' ? 7 : freq.perWeek;
  const targetPerPeriod = protocolData.frequency === 'EOD' ? protocolData.weeklyDose * 2 : protocolData.weeklyDose;

  const calculateRotation = () => {
    const lower = Math.floor(unitsRaw / protocolData.graduation) * protocolData.graduation;
    const higher = lower + protocolData.graduation;
    
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

  // Today's calculations
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const monthNames = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  const isInjectionDay = (date) => {
    const dayOfWeek = date.getDay();
    const startDate = new Date(protocolData.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));

    if (protocolData.frequency === 'ED') return true;
    if (protocolData.frequency === 'EOD') return daysDiff >= 0 ? daysDiff % 2 === 0 : Math.abs(daysDiff) % 2 === 0;
    if (protocolData.frequency === '2xW') return dayOfWeek === 1 || dayOfWeek === 4;
    if (protocolData.frequency === '3xW') return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    return false;
  };

  const todayIsInjectionDay = isInjectionDay(today);
  const todayCompleted = !!injections[todayKey];

  const getDoseForDate = (date) => {
    if (!isInjectionDay(date)) return null;
    if (!rotation) return unitsRounded;

    const startDate = new Date(protocolData.startDate);
    startDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));
    const dayOfWeek = date.getDay();

    let injectionIndex = 0;
    if (protocolData.frequency === 'ED') {
      injectionIndex = ((daysDiff % 7) + 7) % 7;
    } else if (protocolData.frequency === 'EOD') {
      const injectionNumber = Math.floor(daysDiff / 2);
      injectionIndex = ((injectionNumber % 7) + 7) % 7;
    } else if (protocolData.frequency === '2xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : 1;
      injectionIndex = (weekNumber * 2 + positionInWeek) % 2;
    } else if (protocolData.frequency === '3xW') {
      const weekNumber = Math.floor(daysDiff / 7);
      const positionInWeek = dayOfWeek === 1 ? 0 : dayOfWeek === 3 ? 1 : 2;
      injectionIndex = (weekNumber * 3 + positionInWeek) % 3;
    }

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

  // ============ LOADING STATE ============
  if (loading) {
    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p style={{ color: '#64748b' }}>Зареждане...</p>
        </div>
      </div>
    );
  }

  // ============ ONBOARDING SCREEN ============
  if (!session || currentStep === 'onboarding') {
    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="flex flex-col lg:flex-row items-center justify-center p-6 lg:p-12 gap-6">
        
        {/* Left Panel */}
        <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="w-full lg:w-1/2 max-w-xl border rounded-3xl p-8 lg:p-12">
          <div style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }} className="w-20 h-20 rounded-2xl border-2 flex items-center justify-center mb-6 shadow-xl">
            <span className="text-white text-lg font-black tracking-tight">THUB</span>
          </div>
          
          <p style={{ color: '#22d3ee' }} className="text-sm font-semibold tracking-widest mb-4">THUB.BG</p>
          
          <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight mb-6">
            TRT Protocol Management
          </h1>
          
          <p style={{ color: '#64748b' }} className="text-base leading-relaxed mb-8">
            Прецизно дозиране с U-100 спринцовки. Оптимизация на инжекционния график. Проследяване на симптоми и прогрес. Всичко на едно място.
          </p>
          
          <button style={{ borderColor: '#1e3a5f', color: '#94a3b8' }} className="w-full py-4 border rounded-xl font-medium hover:bg-white/5 transition-colors">
            Научи повече за THUB →
          </button>
        </div>

        {/* Right Panel - Auth Form */}
        <div className="w-full lg:w-1/2 max-w-md">
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-3xl p-8 shadow-2xl">
            
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-white">
                {authMode === 'signup' ? 'Създай акаунт' : 'Вход'}
              </h2>
              <div style={{ backgroundColor: '#0a1628' }} className="flex rounded-lg p-1">
                <button
                  onClick={() => { setAuthMode('signin'); setAuthError(''); setErrors({}); }}
                  style={{ backgroundColor: authMode === 'signin' ? '#1e3a5f' : 'transparent', color: authMode === 'signin' ? 'white' : '#64748b' }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Вход
                </button>
                <button
                  onClick={() => { setAuthMode('signup'); setAuthError(''); setErrors({}); }}
                  style={{ backgroundColor: authMode === 'signup' ? '#1e3a5f' : 'transparent', color: authMode === 'signup' ? 'white' : '#64748b' }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Регистрация
                </button>
              </div>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/50">
                <p className="text-red-400 text-sm">{authError}</p>
              </div>
            )}

            <div className="space-y-5">
              {authMode === 'signup' && (
                <div>
                  <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Име</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => { setFormData(prev => ({ ...prev, name: e.target.value })); setErrors({}); }}
                    style={{ backgroundColor: '#0a1628', borderColor: errors.name ? '#ef4444' : '#1e3a5f', color: 'white' }}
                    className="w-full px-4 py-3 border rounded-xl focus:outline-none"
                  />
                  {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
                </div>
              )}

              <div>
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Имейл</label>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => { setFormData(prev => ({ ...prev, email: e.target.value })); setErrors({}); }}
                  style={{ backgroundColor: '#0a1628', borderColor: errors.email ? '#ef4444' : '#1e3a5f', color: 'white' }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none"
                />
                {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
              </div>

              <div>
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Парола</label>
                <input
                  type="password"
                  name="password"
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  value={formData.password}
                  onChange={(e) => { setFormData(prev => ({ ...prev, password: e.target.value })); setErrors({}); }}
                  style={{ backgroundColor: '#0a1628', borderColor: errors.password ? '#ef4444' : '#1e3a5f', color: 'white' }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none"
                />
                {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
              </div>

              {authMode === 'signup' && (
                <>
                  <div>
                    <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Потвърди парола</label>
                    <input
                      type="password"
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={formData.confirmPassword}
                      onChange={(e) => { setFormData(prev => ({ ...prev, confirmPassword: e.target.value })); setErrors({}); }}
                      style={{ backgroundColor: '#0a1628', borderColor: errors.confirmPassword ? '#ef4444' : '#1e3a5f', color: 'white' }}
                      className="w-full px-4 py-3 border rounded-xl focus:outline-none"
                    />
                    {errors.confirmPassword && <p className="text-red-400 text-sm mt-1">{errors.confirmPassword}</p>}
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="newsletter"
                      checked={formData.newsletterConsent}
                      onChange={(e) => setFormData(prev => ({ ...prev, newsletterConsent: e.target.checked }))}
                      className="w-5 h-5 mt-0.5 rounded"
                      style={{ accentColor: '#06b6d4' }}
                    />
                    <label htmlFor="newsletter" style={{ color: '#94a3b8' }} className="text-sm cursor-pointer">
                      Съгласен съм да получавам новини и съвети от THUB
                    </label>
                  </div>
                </>
              )}

              <button
                onClick={authMode === 'signup' ? handleSignUp : handleSignIn}
                disabled={loading}
                style={{ background: 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
                className="w-full py-4 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Зареждане...' : (authMode === 'signup' ? 'Регистрация' : 'Вход')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ PROTOCOL SETUP SCREEN ============
  if (currentStep === 'protocol') {
    const maxUnits = protocolData.graduation === 1 ? 50 : 100;
    const displayUnits = Math.min(unitsRounded, maxUnits);

    return (
      <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }}>
        <header style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="px-4 py-3 flex items-center justify-between sticky top-0 z-40 border-b">
          <button onClick={() => setCurrentStep(protocolData.id ? 'main' : 'onboarding')} style={{ color: '#64748b' }} className="flex items-center gap-2 hover:text-white transition-colors">
            ← Назад
          </button>
          <span className="text-white font-semibold">Настройка на протокол</span>
          <div style={{ width: '60px' }}></div>
        </header>

        <div className="p-4 space-y-4">
          
          {/* Compound */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Препарат</label>
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

          {/* Source */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">Източник на препарата</label>
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
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">Вид масло</label>
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

          {/* Weekly Dose */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Седмична доза ({compound.unit})</label>
            <input
              type="number"
              value={protocolData.weeklyDose}
              onChange={(e) => setProtocolData(prev => ({ ...prev, weeklyDose: parseFloat(e.target.value) || 0 }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none text-lg"
            />
          </div>

          {/* Frequency */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Честота</label>
            <select
              value={protocolData.frequency}
              onChange={(e) => setProtocolData(prev => ({ ...prev, frequency: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            >
              {frequenciesData.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Graduation */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-3">Скала на спринцовката</label>
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

          {/* Start Date */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">Начало на протокола</label>
            <input
              type="date"
              value={protocolData.startDate}
              onChange={(e) => setProtocolData(prev => ({ ...prev, startDate: e.target.value }))}
              style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none"
            />
          </div>

          {/* Syringe Preview */}
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-6">
            <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-4 text-center">Preview на дозата</label>
            
            <div className="flex items-center justify-center gap-8">
              <div className="relative">
                <div style={{ backgroundColor: '#0a1628', borderColor: '#475569', width: '100px', height: '380px' }} className="relative border-2 rounded-xl overflow-hidden">
                  {(protocolData.graduation === 2 ? Array.from({ length: 51 }, (_, i) => i * 2) : Array.from({ length: 51 }, (_, i) => i)).map(tick => {
                    const pos = 4 + ((maxUnits - tick) / maxUnits) * 92;
                    const isMajor = tick % 10 === 0;
                    const isMedium = tick % 5 === 0 && !isMajor;
                    return (
                      <div key={tick} className="absolute w-full left-0 right-0" style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}>
                        <div className="flex items-center justify-between px-2">
                          <div style={{ backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569', width: isMajor ? '16px' : isMedium ? '10px' : '6px', height: isMajor ? '2px' : '1px' }} />
                          {isMajor && <span style={{ color: '#e2e8f0', fontSize: '11px' }} className="font-bold">{tick}</span>}
                          <div style={{ backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569', width: isMajor ? '16px' : isMedium ? '10px' : '6px', height: isMajor ? '2px' : '1px' }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ background: 'linear-gradient(to top, #0891b2, #06b6d4, #22d3ee)', height: `${4 + (displayUnits / maxUnits) * 92}%`, opacity: 0.6 }} className="absolute bottom-0 left-0 right-0 transition-all duration-500 rounded-b-lg" />
                </div>
                <div style={{ color: '#64748b' }} className="text-center text-xs mt-2">Скала {protocolData.graduation}U (0-{maxUnits}U)</div>
              </div>

              <div className="text-center">
                <div style={{ color: '#64748b' }} className="text-sm mb-1">Дръпни до</div>
                <div style={{ color: '#22d3ee' }} className="text-6xl font-bold mb-2">{unitsRounded}U</div>
                <div style={{ color: '#64748b' }} className="space-y-1 text-sm">
                  <div>{actualDose.toFixed(1)} {compound.unit}</div>
                  <div>{actualMl.toFixed(3)} mL</div>
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
            {protocolData.id ? 'Запази промените' : 'Запази протокол'} →
          </button>
        </div>

        {/* Change Confirmation Modal */}
        {showChangeModal && (
          <div style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="w-full max-w-md border rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-white text-xl font-bold">Промяна в протокола</h3>
              </div>

              <div style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }} className="border rounded-xl p-4 mb-4">
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

              <div className="mb-4">
                <label style={{ color: '#64748b' }} className="block text-sm font-medium mb-2">
                  Причина за промяната <span style={{ color: '#f87171' }}>*</span>
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Напр: Кръвни резултати показаха..."
                  style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f', color: 'white' }}
                  className="w-full px-4 py-3 border rounded-xl focus:outline-none resize-none"
                  rows={3}
                />
              </div>

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
                    background: changeReason.trim() ? 'linear-gradient(90deg, #06b6d4, #14b8a6)' : '#334155',
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
  const SyringeMain = ({ units }) => {
    const maxUnits = protocolData.graduation === 1 ? 50 : 100;
    const displayUnits = Math.min(units, maxUnits);
    const ticks = protocolData.graduation === 2
      ? Array.from({ length: 51 }, (_, i) => i * 2)
      : Array.from({ length: 51 }, (_, i) => i);

    return (
      <div className="relative">
        <div style={{ backgroundColor: '#0f172a', borderColor: '#334155', width: '100px', height: '340px' }} className="relative border-2 rounded-xl overflow-hidden">
          {ticks.map(tick => {
            const pos = 4 + ((maxUnits - tick) / maxUnits) * 92;
            const isMajor = tick % 10 === 0;
            const isMedium = tick % 5 === 0 && !isMajor;
            return (
              <div key={tick} className="absolute w-full left-0 right-0" style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}>
                <div className="flex items-center justify-between px-1">
                  <div style={{ backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569', width: isMajor ? '16px' : isMedium ? '10px' : '6px', height: isMajor ? '2px' : '1px' }} />
                  {isMajor && <span style={{ color: '#e2e8f0', fontSize: '10px' }} className="font-bold">{tick}</span>}
                  <div style={{ backgroundColor: isMajor ? '#e2e8f0' : isMedium ? '#64748b' : '#475569', width: isMajor ? '16px' : isMedium ? '10px' : '6px', height: isMajor ? '2px' : '1px' }} />
                </div>
              </div>
            );
          })}
          <div 
            style={{ 
              background: todayCompleted ? 'linear-gradient(to top, #059669, #10b981, #34d399)' : 'linear-gradient(to top, #0891b2, #06b6d4, #22d3ee)',
              height: `${4 + (displayUnits / maxUnits) * 92}%`,
              opacity: 0.7
            }}
            className="absolute bottom-0 left-0 right-0 transition-all duration-500 rounded-b-lg"
          />
        </div>
        <div style={{ color: '#64748b' }} className="text-center text-xs mt-2">{actualMl.toFixed(2)} mL</div>
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: '#0a1628', minHeight: '100vh' }} className="pb-24">
      
      {/* Header */}
      <header style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="px-4 py-3 flex items-center justify-between sticky top-0 z-40 border-b">
        <div className="flex items-center gap-3">
          <div style={{ backgroundColor: '#0a1628', borderColor: '#1e3a5f' }} className="w-10 h-10 rounded-lg border flex items-center justify-center">
            <span className="text-white text-xs font-black">THUB</span>
          </div>
          <div>
            <p className="text-white font-semibold">{profile?.name || 'Потребител'}</p>
            <p style={{ color: '#64748b' }} className="text-xs">{freq.shortName} • {protocolData.weeklyDose} {compound.unit}/сед</p>
          </div>
        </div>
        <button onClick={() => setCurrentStep('protocol')} style={{ color: '#64748b' }} className="p-2 hover:text-white transition-colors" title="Редактирай протокол">
          ⚙️
        </button>
      </header>

      {/* Content */}
      <main className="p-4">
        
        {/* TODAY TAB */}
        {activeTab === 'today' && (
          <div className="space-y-4">
            
            <div className="text-center">
              <p style={{ color: '#64748b' }} className="text-sm">{dayNames[today.getDay()]}</p>
              <p className="text-white text-3xl font-bold">{today.getDate()} {monthNames[today.getMonth()]}</p>
            </div>

            {todayIsInjectionDay ? (
              <>
                <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-6">
                  <div className="flex items-center justify-center gap-8">
                    <SyringeMain units={todayDose} />
                    <div className="text-center">
                      <p style={{ color: '#64748b' }} className="text-sm mb-1">Дръпни до</p>
                      <p style={{ color: todayCompleted ? '#34d399' : '#22d3ee' }} className="text-6xl font-bold">{todayDose}U</p>
                      <div style={{ color: '#64748b' }} className="text-sm mt-2 space-y-1">
                        <p>{actualDose.toFixed(1)} {compound.unit}</p>
                        <p>{actualMl.toFixed(2)} mL</p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={toggleTodayInjection}
                    style={{ background: todayCompleted ? 'linear-gradient(90deg, #059669, #10b981)' : 'linear-gradient(90deg, #06b6d4, #14b8a6)' }}
                    className="w-full mt-6 py-4 text-white font-semibold rounded-xl transition-all"
                  >
                    {todayCompleted ? `✓ Направено ${injections[todayKey]?.time}` : '💉 Маркирай като направено'}
                  </button>
                </div>

                {rotation && rotation.lowerCount > 0 && rotation.higherCount > 0 && (
                  <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
                    <p style={{ color: '#22d3ee' }} className="font-semibold mb-3">Оптимизация на графика</p>
                    <div className="flex justify-center gap-2 mb-3">
                      {(() => {
                        const schedule = [];
                        let higherUsed = 0;
                        for (let i = 0; i < injectionsPerPeriod; i++) {
                          const expectedHigher = Math.round((i + 1) * rotation.higherCount / injectionsPerPeriod);
                          if (higherUsed < expectedHigher) { schedule.push(rotation.higherUnits); higherUsed++; }
                          else { schedule.push(rotation.lowerUnits); }
                        }
                        return schedule.map((units, i) => (
                          <div key={i} style={{ backgroundColor: units === rotation.higherUnits ? '#0891b2' : '#164e63' }} className="px-3 py-2 rounded-lg">
                            <span className="text-white font-bold">{units}U</span>
                          </div>
                        ));
                      })()}
                    </div>
                    <p style={{ color: '#94a3b8' }} className="text-xs text-center">
                      {rotation.lowerCount}×{rotation.lowerUnits}U + {rotation.higherCount}×{rotation.higherUnits}U = {rotation.totalMg.toFixed(1)} {compound.unit}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-8 text-center">
                <p className="text-5xl mb-4">😌</p>
                <p className="text-white text-2xl font-bold">Почивен ден</p>
                <p style={{ color: '#64748b' }} className="mt-2">Следваща инжекция скоро</p>
              </div>
            )}
          </div>
        )}

        {/* CALENDAR TAB */}
        {activeTab === 'calendar' && (
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} style={{ color: '#64748b' }} className="p-2">←</button>
              <h3 className="text-white font-bold">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
              <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} style={{ color: '#64748b' }} className="p-2">→</button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map(d => (<div key={d} style={{ color: '#64748b' }} className="text-center text-xs py-1">{d}</div>))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth();
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells = [];
                for (let i = 0; i < firstDay; i++) { cells.push(<div key={`empty-${i}`} />); }
                for (let day = 1; day <= daysInMonth; day++) {
                  const date = new Date(year, month, day);
                  const dateKey = `${year}-${month}-${day}`;
                  const isInj = isInjectionDay(date);
                  const done = !!injections[dateKey];
                  const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                  const dose = isInj ? getDoseForDate(date) : null;
                  cells.push(
                    <div key={day} style={{ backgroundColor: isInj ? (done ? '#059669' : '#0891b2') : '#1e293b', borderColor: isToday ? '#22d3ee' : 'transparent' }} className="aspect-square rounded-lg flex flex-col items-center justify-center text-xs border-2">
                      <span className="text-white font-semibold">{day}</span>
                      {isInj && <span style={{ color: done ? '#d1fae5' : '#cffafe' }} className="text-xs">{dose}U</span>}
                    </div>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
              <h3 className="text-white font-bold mb-4">Текущ протокол</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Препарат</span><span className="text-white">{compound.shortName}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Източник</span><span className="text-white">{sourceNames[protocolData.source]}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Масло</span><span className="text-white">{oilNames[protocolData.oilType]}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Седмична доза</span><span className="text-white">{protocolData.weeklyDose} {compound.unit}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Честота</span><span className="text-white">{freq.name}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Доза/инжекция</span><span style={{ color: '#22d3ee' }} className="font-bold">{unitsRounded}U</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Начало</span><span className="text-white">{new Date(protocolData.startDate).toLocaleDateString('bg-BG')}</span></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4 text-center">
                <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">{Object.keys(injections).length}</p>
                <p style={{ color: '#64748b' }} className="text-sm">Инжекции</p>
              </div>
              <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4 text-center">
                <p style={{ color: '#22d3ee' }} className="text-3xl font-bold">{Math.floor((new Date() - new Date(protocolData.startDate)) / (1000 * 60 * 60 * 24 * 7))}</p>
                <p style={{ color: '#64748b' }} className="text-sm">Седмици</p>
              </div>
            </div>
          </div>
        )}

        {/* JOURNAL TAB */}
        {activeTab === 'journal' && (
          <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-8 text-center">
            <p className="text-4xl mb-4">📝</p>
            <p className="text-white font-bold">Журнал</p>
            <p style={{ color: '#64748b' }} className="text-sm mt-2">Скоро...</p>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="border rounded-2xl p-4">
              <h3 className="text-white font-bold mb-4">Профил</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Име</span><span className="text-white">{profile?.name}</span></div>
                <div className="flex justify-between"><span style={{ color: '#64748b' }}>Имейл</span><span className="text-white">{profile?.email}</span></div>
              </div>
            </div>
            <button onClick={() => setCurrentStep('protocol')} style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="w-full border rounded-2xl p-4 text-left flex items-center justify-between">
              <span className="text-white">Редактирай протокол</span>
              <span style={{ color: '#64748b' }}>→</span>
            </button>
            <button onClick={handleSignOut} style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="w-full border rounded-2xl p-4 text-left flex items-center justify-between">
              <span className="text-white">🚪 Изход</span>
              <span style={{ color: '#64748b' }}>→</span>
            </button>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav style={{ backgroundColor: '#0f172a', borderColor: '#1e3a5f' }} className="fixed bottom-0 left-0 right-0 border-t px-2 py-2 flex justify-around">
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
            style={{ backgroundColor: activeTab === tab.id ? '#1e3a5f' : 'transparent', color: activeTab === tab.id ? '#22d3ee' : '#64748b' }}
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
