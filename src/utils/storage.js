// THUB Storage - localStorage functions and data migration

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
