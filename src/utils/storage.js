// THUB Storage - Supabase + localStorage
// localStorage = бърз кеш (мигновен достъп)
// Supabase = основно хранилище (пази данните завинаги)

import { supabase } from '../supabaseClient';

// ============ LOCAL STORAGE — кеш за бързина (непроменено) ============

export const loadFromStorage = (key, defaultValue) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch {
    return defaultValue;
  }
};

export const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

// ============ МИГРАЦИИ (непроменено) ============

export const migrateCompoundId = (oldId) => {
  const migrations = {
    'test_c_e_200': 'test_e_200',
    'test_c_e_250': 'test_e_250',
  };
  return migrations[oldId] || oldId;
};

export const migrateProfile = (saved) => {
  if (!saved) return saved;

  if (saved.protocol && saved.protocol.compound) {
    const newCompoundId = migrateCompoundId(saved.protocol.compound);
    if (newCompoundId !== saved.protocol.compound) {
      saved.protocol.compound = newCompoundId;
      saveToStorage('thub-profile', saved);
    }
  }

  // Migrate to protocolVersions
  if (saved.protocol && !saved.protocolVersions) {
    saved.protocolVersions = [{
      ...saved.protocol,
      effectiveFrom: saved.protocol.startDate,
      createdAt: saved.lastModified || new Date().toISOString(),
      note: null
    }];
    saveToStorage('thub-profile', saved);
  }

  return saved;
};


// ================================================================
// SUPABASE — АВТЕНТИКАЦИЯ (ново)
// ================================================================

// Регистрация — създава РЕАЛЕН акаунт с криптирана парола
export const authSignUp = async (email, password, name) => {
  // Стъпка 1: Създаваме акаунт в Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    // Превеждаме грешките на български
    if (error.message.includes('already registered')) {
      return { data: null, error: 'Този имейл вече е регистриран' };
    }
    if (error.message.includes('valid email')) {
      return { data: null, error: 'Невалиден имейл адрес' };
    }
    if (error.message.includes('password')) {
      return { data: null, error: 'Паролата трябва да е минимум 6 символа' };
    }
    return { data: null, error: error.message };
  }

  // Стъпка 2: Създаваме профил в profiles таблицата
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        name: name,
        email: email,
        protocol_configured: false,
        updated_at: new Date().toISOString()
      });

    if (profileError) {
      return { data: null, error: 'Грешка при създаване на профил: ' + profileError.message };
    }
  }

  return { data, error: null };
};

// Вход — проверява РЕАЛНА парола
export const authSignIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message.includes('Invalid login')) {
      return { data: null, error: 'Грешен имейл или парола' };
    }
    return { data: null, error: error.message };
  }

  return { data, error: null };
};

// Изход — изчиства сесията и кеша
export const authSignOut = async () => {
  const { error } = await supabase.auth.signOut();
  localStorage.removeItem('thub-profile');
  localStorage.removeItem('thub-injections');
  return { error };
};

// Забравена парола — изпраща имейл за възстановяване
export const authResetPassword = async (email) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
};

// Взима текущата сесия (дали е логнат)
export const authGetSession = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};

// Слуша за промени в автентикацията (login/logout)
export const authOnChange = (callback) => {
  return supabase.auth.onAuthStateChange(callback);
};


// ================================================================
// SUPABASE — ПРОФИЛ (ново)
// ================================================================

// Зарежда профил от базата данни
export const dbLoadProfile = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data;
};

// Записва профил в базата данни
export const dbSaveProfile = async (userId, profileData) => {
  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      name: profileData.name,
      email: profileData.email,
      protocol_configured: profileData.protocolConfigured || false,
      updated_at: new Date().toISOString()
    });

  return { error };
};


// ================================================================
// SUPABASE — ПРОТОКОЛ (ново)
// ================================================================

// Зарежда активния протокол от базата данни
export const dbLoadProtocol = async (userId) => {
  const { data, error } = await supabase
    .from('protocols')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const p = data[0];

  // Конвертираме от Supabase формат към формата на апа
  return {
    compound: p.compound,
    weeklyDose: Number(p.weekly_dose),
    frequency: p.frequency,
    graduation: p.graduation,
    startDate: p.start_date,
    source: p.source || 'unknown',
    oilType: p.oil_type || 'unknown',
    injectionMethod: p.injection_method || 'im',
    injectionLocation: p.injection_location || 'glute',
    showNowIndicator: p.show_now_indicator !== false,
    effectiveFrom: p.effective_from,
    note: p.note,
    _dbId: p.id // Пазим ID-то за update-и и history
  };
};

// Записва нов протокол (деактивира стария автоматично)
export const dbSaveProtocol = async (userId, protocolData) => {
  // Стъпка 1: Деактивираме стария протокол
  await supabase
    .from('protocols')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_active', true);

  // Стъпка 2: Записваме новия протокол
  const { data, error } = await supabase
    .from('protocols')
    .insert({
      user_id: userId,
      compound: protocolData.compound,
      weekly_dose: protocolData.weeklyDose,
      frequency: protocolData.frequency,
      graduation: protocolData.graduation,
      start_date: protocolData.startDate,
      source: protocolData.source || 'unknown',
      oil_type: protocolData.oilType || 'unknown',
      injection_method: protocolData.injectionMethod || 'im',
      injection_location: protocolData.injectionLocation || 'glute',
      show_now_indicator: protocolData.showNowIndicator !== false,
      effective_from: protocolData.effectiveFrom || protocolData.startDate,
      note: protocolData.note || null,
      is_active: true
    })
    .select()
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
};


// ================================================================
// SUPABASE — ИНЖЕКЦИИ (ново)
// ================================================================

// Зарежда ВСИЧКИ инжекции на потребителя
export const dbLoadInjections = async (userId) => {
  const { data, error } = await supabase
    .from('injections')
    .select('*')
    .eq('user_id', userId);

  if (error || !data) return {};

  // Конвертираме към формата на апа: { "2026-1-7": { status, time, dose, ... } }
  const injMap = {};
  for (const inj of data) {
    // inj.date е "2026-02-07", конвертираме към "2026-1-7" (JS формат)
    const d = new Date(inj.date + 'T12:00:00'); // T12 за да избегнем timezone проблеми
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    injMap[key] = {
      status: inj.status || 'done',
      time: inj.time || undefined,
      dose: inj.dose_units || undefined,
      location: inj.location || undefined,
      side: inj.side || undefined,
      note: inj.notes || undefined,
      missReason: inj.miss_reason || undefined,
      _dbId: inj.id
    };
  }

  return injMap;
};

// Записва или обновява една инжекция
export const dbSaveInjection = async (userId, protocolId, dateKey, injectionData) => {
  // dateKey е "2026-1-7" → трябва ни "2026-02-07" за базата
  const parts = dateKey.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]); // JS month (0-based)
  const day = parseInt(parts[2]);
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Проверяваме дали вече има запис за този ден
  const { data: existing } = await supabase
    .from('injections')
    .select('id')
    .eq('user_id', userId)
    .eq('date', dateStr);

  if (existing && existing.length > 0) {
    // Обновяваме
    const { error } = await supabase
      .from('injections')
      .update({
        status: injectionData.status || 'done',
        time: injectionData.time || null,
        dose_units: injectionData.dose || null,
        location: injectionData.location || null,
        side: injectionData.side || null,
        notes: injectionData.note || null,
        miss_reason: injectionData.missReason || null,
      })
      .eq('id', existing[0].id);

    return { error };
  } else {
    // Създаваме нов
    const { error } = await supabase
      .from('injections')
      .insert({
        user_id: userId,
        protocol_id: protocolId,
        date: dateStr,
        status: injectionData.status || 'done',
        time: injectionData.time || null,
        dose_units: injectionData.dose || null,
        location: injectionData.location || null,
        side: injectionData.side || null,
        notes: injectionData.note || null,
        miss_reason: injectionData.missReason || null,
      });

    return { error };
  }
};

// Трие инжекция
export const dbDeleteInjection = async (userId, dateKey) => {
  const parts = dateKey.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const { error } = await supabase
    .from('injections')
    .delete()
    .eq('user_id', userId)
    .eq('date', dateStr);

  return { error };
};


// ================================================================
// SUPABASE — ИСТОРИЯ НА ПРОТОКОЛИ (ново)
// ================================================================

export const dbSaveProtocolHistory = async (userId, protocolId, changes, reason, oldData, newData) => {
  const { error } = await supabase
    .from('protocol_history')
    .insert({
      user_id: userId,
      protocol_id: protocolId,
      changes: changes,
      reason: reason,
      old_data: oldData,
      new_data: newData
    });

  return { error };
};
