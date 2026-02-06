// THUB Constants - Compounds, Frequencies, Labels

export const compounds = [
  { id: 'test_c_200', name: 'Testosterone Cypionate 200mg/mL', shortName: 'Test Cypionate 200', concentration: 200, unit: 'mg' },
  { id: 'test_e_200', name: 'Testosterone Enanthate 200mg/mL', shortName: 'Test Enanthate 200', concentration: 200, unit: 'mg' },
  { id: 'test_e_250', name: 'Testosterone Enanthate 250mg/mL', shortName: 'Test Enanthate 250', concentration: 250, unit: 'mg' },
  { id: 'test_c_250', name: 'Testosterone Cypionate 250mg/mL', shortName: 'Test Cypionate 250', concentration: 250, unit: 'mg' },
  { id: 'test_p_100', name: 'Testosterone Propionate 100mg/mL', shortName: 'Test Propionate 100', concentration: 100, unit: 'mg' },
  { id: 'test_u_250', name: 'Testosterone Undecanoate 250mg/mL', shortName: 'Test Undecanoate 250', concentration: 250, unit: 'mg' },
  { id: 'hcg', name: 'HCG 5000IU / 5mL', shortName: 'HCG', concentration: 1000, unit: 'IU' },
];

export const frequencies = [
  { id: 'ED', name: 'Всеки ден (ED)', shortName: 'ED', perWeek: 7, periodDays: 7 },
  { id: 'EOD', name: 'През ден (EOD)', shortName: 'EOD', perWeek: 3.5, periodDays: 14 },
  { id: '3xW', name: '3× седмично (Пон/Ср/Пет)', shortName: '3xW', perWeek: 3, periodDays: 7 },
  { id: '2xW', name: '2× седмично (Пон/Чет)', shortName: '2xW', perWeek: 2, periodDays: 7 },
  { id: '1xW', name: '1× седмично', shortName: '1xW', perWeek: 1, periodDays: 7 },
  { id: '1x2W', name: '1× на 2 седмици', shortName: '1x2W', perWeek: 0.5, periodDays: 14 },
];

export const compoundNames = {
  'test_c_200': 'Testosterone Cypionate 200mg/mL',
  'test_e_200': 'Testosterone Enanthate 200mg/mL',
  'test_e_250': 'Testosterone Enanthate 250mg/mL',
  'test_c_250': 'Testosterone Cypionate 250mg/mL',
  'test_p_100': 'Testosterone Propionate 100mg/mL',
  'test_u_250': 'Testosterone Undecanoate 250mg/mL',
  'hcg': 'HCG 5000IU / 5mL',
};

export const frequencyNames = {
  'ED': 'Всеки ден',
  'EOD': 'През ден',
  '3xW': '3× седмично',
  '2xW': '2× седмично',
  '1xW': '1× седмично',
  '1x2W': '1× на 2 седмици',
};

export const sourceLabels = {
  pharmacy: 'Аптека',
  ugl: 'UGL',
  unknown: 'Не знам'
};

export const oilLabels = {
  mct: 'MCT',
  grape_seed: 'Grape Seed',
  sesame: 'Sesame',
  castor: 'Castor',
  other: 'Друго',
  unknown: 'Не знам'
};

export const methodLabels = {
  im: 'IM',
  subq: 'SubQ'
};

export const locationOptions = [
  { id: 'glute', label: 'Глутеус', emoji: '🍑' },
  { id: 'delt', label: 'Делтоид', emoji: '💪' },
  { id: 'quad', label: 'Бедро', emoji: '🦵' },
  { id: 'abdomen', label: 'Корем', emoji: '⭕' }
];

export const monthNames = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

export const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
