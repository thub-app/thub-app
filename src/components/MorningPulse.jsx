import React, { useState, useEffect } from 'react';

// ============================================
// MORNING PULSE COMPONENT v1
// 3 въпроса, 3 тапа, 5 секунди
// ============================================

const MorningPulse = ({ onComplete, date = new Date() }) => {
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [erection, setErection] = useState(null);
  const [wakeup, setWakeup] = useState(null);
  const [sleep, setSleep] = useState(null);
  
  // Date key за localStorage
  const getDateKey = () => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  
  // Load от localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`pulse_${getDateKey()}`);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setErection(data.erection || null);
        setWakeup(data.wakeup || null);
        setSleep(data.sleep || null);
        if (data.erection && data.wakeup && data.sleep) {
          setIsExpanded(false);
        }
      } catch (e) {
        console.error('Pulse load error:', e);
      }
    }
  }, []);
  
  // Save в localStorage
  useEffect(() => {
    if (erection || wakeup || sleep) {
      const data = {
        date: getDateKey(),
        erection,
        wakeup,
        sleep,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`pulse_${getDateKey()}`, JSON.stringify(data));
    }
  }, [erection, wakeup, sleep]);
  
  // Auto-collapse след 3-ти отговор
  useEffect(() => {
    if (erection && wakeup && sleep) {
      setTimeout(() => {
        setIsExpanded(false);
        if (onComplete) onComplete();
      }, 300);
    }
  }, [erection, wakeup, sleep]);
  
  // Button component
  const Button = ({ label, value, selected, onClick }) => (
    <button
      onClick={() => onClick(value)}
      style={{
        flex: 1,
        padding: '14px 16px',
        borderRadius: '8px',
        border: selected ? '1px solid #00C896' : '1px solid rgba(255,255,255,0.2)',
        backgroundColor: selected ? '#00C896' : 'transparent',
        color: '#fff',
        fontSize: '14px',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {label}
    </button>
  );
  
  // Summary text
  const getSummaryText = () => {
    const parts = [];
    if (erection) {
      const map = { yes: 'Да', weak: 'Слаба', no: 'Не' };
      parts.push(map[erection]);
    }
    if (wakeup) {
      const map = { fresh: 'Свеж', normal: 'Норм', heavy: 'Тежко' };
      parts.push(map[wakeup]);
    }
    if (sleep) {
      const map = { '<6': '<6ч', '6-8': '6-8ч', '8+': '8+' };
      parts.push(map[sleep]);
    }
    return parts.join(' | ');
  };
  
  return (
    <div style={{
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      overflow: 'hidden',
      marginBottom: '20px'
    }}>
      
      {/* Header */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          cursor: 'pointer'
        }}
      >
        <span style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
          Сутрешен пулс
        </span>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {(erection || wakeup || sleep) && (
            <span style={{
              backgroundColor: 'rgba(0, 200, 150, 0.2)',
              color: '#00C896',
              padding: '5px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: '500'
            }}>
              {getSummaryText()}
            </span>
          )}
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </div>
      
      {/* Content */}
      {isExpanded && (
        <div style={{ padding: '0 16px 20px 16px' }}>
          
          {/* Q1: Ерекция */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', textAlign: 'center', marginBottom: '12px' }}>
              Сутрешна ерекция?
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button label="Да" value="yes" selected={erection === 'yes'} onClick={setErection} />
              <Button label="Слаба" value="weak" selected={erection === 'weak'} onClick={setErection} />
              <Button label="Не" value="no" selected={erection === 'no'} onClick={setErection} />
            </div>
          </div>
          
          {/* Q2: Събуждане */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', textAlign: 'center', marginBottom: '12px' }}>
              Как се събуди?
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button label="Свеж" value="fresh" selected={wakeup === 'fresh'} onClick={setWakeup} />
              <Button label="Нормално" value="normal" selected={wakeup === 'normal'} onClick={setWakeup} />
              <Button label="Тежко" value="heavy" selected={wakeup === 'heavy'} onClick={setWakeup} />
            </div>
          </div>
          
          {/* Q3: Сън */}
          <div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', textAlign: 'center', marginBottom: '12px' }}>
              Сън?
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button label="<6ч" value="<6" selected={sleep === '<6'} onClick={setSleep} />
              <Button label="6-8ч" value="6-8" selected={sleep === '6-8'} onClick={setSleep} />
              <Button label="8+" value="8+" selected={sleep === '8+'} onClick={setSleep} />
            </div>
          </div>
          
        </div>
      )}
      
    </div>
  );
};

export default MorningPulse;
