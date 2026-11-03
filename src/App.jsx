import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { evaluateMotorStatus, IEEE_VOLTAGE_THRESHOLDS } from './utils/ieeeStandards';
import { 
  subscribeToMotors,
  logTestReading, 
  createMotorAsset,
  provisionUserWithId, 
  fetchRegisteredUsers,
  subscribeToLiveTelemetry,
  fetchTelemetryHistory
} from './services/telemetryService';
import { exportTelemetryToCSV, exportMaintenanceReportPDF } from './utils/reportGenerator';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LogOut, 
  Plus,
  ArrowRight,
  CheckCircle2,
  ArrowLeft,
  Radio,
  LayoutGrid,
  Activity,
  FileText,
  ShieldCheck,
  Users,
  LogOut as LogOutIcon,
  Zap
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function App() {
  const { currentUser, logout, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('fleet');
  
  const defaultMotors = [
    { id: 'motor-mock', motor_name: 'MOCK GATEWAY TEST RIG', location: 'LAB BENCH (SIMULATOR)', rated_voltage: 380 },
    { id: 'motor-001', motor_name: 'WATER PUMP 01', location: 'PUMP ROOM BASEMENT', rated_voltage: 480 },
    { id: 'motor-002', motor_name: 'BOOSTER PUMP 02', location: 'HVAC ROOFTOP', rated_voltage: 380 },
    { id: 'motor-003', motor_name: 'DRAINAGE PUMP 03', location: 'SUMP BASIN', rated_voltage: 240 }
  ];

  const [motors, setMotors] = useState(defaultMotors);
  const [selectedMotor, setSelectedMotor] = useState(null);

  // Real-time & History States
  const [liveTelemetry, setLiveTelemetry] = useState(null);
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [registeredUsers, setRegisteredUsers] = useState([]);

  // Filter States
  const [lineFilterGroup, setLineFilterGroup] = useState('ALL'); // ALL, PHASE_TO_PHASE, PHASE_TO_GROUND
  const [voltageFilter, setVoltageFilter] = useState('ALL'); // ALL, 100, 250, 500, 1000

  // 6-Line Simulation Form Inputs
  const [simAB, setSimAB] = useState(2.40);
  const [simBC, setSimBC] = useState(2.42);
  const [simCA, setSimCA] = useState(2.38);
  const [simAG, setSimAG] = useState(2.25);
  const [simBG, setSimBG] = useState(2.28);
  const [simCG, setSimCG] = useState(2.20);
  
  const [simTemp, setSimTemp] = useState(38.5);
  const [simTestVoltage, setSimTestVoltage] = useState(1000);
  const [simMinutes, setSimMinutes] = useState(1.0);
  const [simNcAux, setSimNcAux] = useState(true);
  const [simZeroVolt, setSimZeroVolt] = useState(true);
  const [isExecutingTest, setIsExecutingTest] = useState(false);
  const [testExecutionError, setTestExecutionError] = useState('');

  // Modals & User Management
  const [showAddMotorModal, setShowAddMotorModal] = useState(false);
  const [newMotorName, setNewMotorName] = useState('');
  const [newMotorLocation, setNewMotorLocation] = useState('');
  const [newMotorVoltage, setNewMotorVoltage] = useState(380);

  const [newEmpId, setNewEmpId] = useState('');
  const [newFullname, setNewFullname] = useState('');
  const [newPin, setNewPin] = useState('1234');
  const [newRole, setNewRole] = useState('Employee');
  const [userCreatedMessage, setUserCreatedMessage] = useState('');

  const navItems = [
    { id: 'fleet', label: 'FLEET', icon: LayoutGrid, section: 'global' },
    ...(selectedMotor ? [
      { id: 'overview', label: 'MONITOR', icon: Activity, section: 'station' },
      { id: 'telemetry', label: 'LOGS', icon: FileText, section: 'station' },
      { id: 'safety', label: 'INTERLOCKS', icon: ShieldCheck, section: 'station' },
    ] : []),
    ...(isAdmin ? [
      { id: 'settings', label: 'USERS & ACCESS', mobileLabel: 'ACCESS', icon: Users, section: 'global' }
    ] : []),
  ];

  useEffect(() => {
    if (!isAdmin && activeTab === 'settings') setActiveTab('fleet');
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!currentUser) return;
    const unsubMotors = subscribeToMotors((data) => {
      if (data && data.length > 0) {
        const hasMock = data.some(m => m.id === 'motor-mock');
        setMotors(hasMock ? data : [defaultMotors[0], ...data]);
      } else {
        setMotors(defaultMotors);
      }
    });
    return () => unsubMotors();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const unsubLive = subscribeToLiveTelemetry((data) => {
      if (data) setLiveTelemetry(data);
    });

    const loadHistory = async () => {
      const historyData = await fetchTelemetryHistory();
      if (historyData && historyData.length > 0) {
        const formatted = historyData.map((item) => {
          const rawAB = Number(item.raw_ab || item.rawIR || 2.40);
          const rawBC = Number(item.raw_bc || item.rawIR || 2.42);
          const rawCA = Number(item.raw_ca || item.rawIR || 2.38);
          const rawAG = Number(item.raw_ag || item.rawIR || 2.25);
          const rawBG = Number(item.raw_bg || item.rawIR || 2.28);
          const rawCG = Number(item.raw_cg || item.rawIR || 2.20);
          
          const temp = Number(item.temperatureC || 38.5);
          const kt = temp >= 40.0 ? Math.pow(0.5, (temp - 40.0) / 10.0) : Math.pow(2.0, (40.0 - temp) / 10.0);

          return {
            id: item.id || item.timestamp,
            motor_id: item.motorId || 'motor-mock',
            ab_corrected: Number((rawAB * kt).toFixed(2)),
            bc_corrected: Number((rawBC * kt).toFixed(2)),
            ca_corrected: Number((rawCA * kt).toFixed(2)),
            ag_corrected: Number((rawAG * kt).toFixed(2)),
            bg_corrected: Number((rawBG * kt).toFixed(2)),
            cg_corrected: Number((rawCG * kt).toFixed(2)),
            raw_ir: Number((rawCG * kt).toFixed(2)),
            temperature: temp,
            test_voltage: Number(item.testVoltage || item.test_voltage || item.ratedVoltage || 1000),
            minutes: Number(item.minutes || 1.0),
            ir_min: Number(item.thresholdIR || 1.38),
            motor_status: item.status || 'NORMAL',
            operator_name: item.operatorName || 'Python Gateway OCR',
            formattedDate: item.timestamp 
              ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'LIVE'
          };
        });
        setTelemetryLogs(formatted);
      }
    };

    loadHistory();
    const interval = setInterval(loadHistory, 4000);
    if (isAdmin) fetchRegisteredUsers().then(setRegisteredUsers).catch(console.error);

    return () => {
      unsubLive();
      clearInterval(interval);
    };
  }, [currentUser, isAdmin]);

  if (!currentUser) return <Login />;

  const handleSelectMotor = (motor) => {
    setSelectedMotor(motor);
    setActiveTab('overview');
  };

  const handleCloseActiveMotor = () => {
    setSelectedMotor(null);
    setActiveTab('fleet');
  };

  const filteredLogs = selectedMotor?.id === 'motor-mock'
    ? telemetryLogs
    : telemetryLogs.filter(l => l.motor_id === selectedMotor?.id);

  // Filter dataset by test voltage safely with type casting
  const chartDataset = filteredLogs.filter(log => {
    if (voltageFilter === 'ALL') return true;
    return Number(log.test_voltage) === Number(voltageFilter);
  });

  const latest = (selectedMotor?.id === 'motor-mock' && liveTelemetry) ? {
    raw_ir: Number(liveTelemetry.rawIR || 2.20).toFixed(2),
    ab_corrected: Number(liveTelemetry.raw_ab || 2.40).toFixed(2),
    bc_corrected: Number(liveTelemetry.raw_bc || 2.42).toFixed(2),
    ca_corrected: Number(liveTelemetry.raw_ca || 2.38).toFixed(2),
    ag_corrected: Number(liveTelemetry.raw_ag || 2.25).toFixed(2),
    bg_corrected: Number(liveTelemetry.raw_bg || 2.28).toFixed(2),
    cg_corrected: Number(liveTelemetry.raw_cg || 2.20).toFixed(2),
    temperature: Number(liveTelemetry.temperatureC || 38.5).toFixed(1),
    test_voltage: Number(liveTelemetry.testVoltage || liveTelemetry.test_voltage || 1000),
    minutes: Number(liveTelemetry.minutes || 1.0),
    motor_status: liveTelemetry.status || "NORMAL",
    formattedDate: liveTelemetry.timestamp ? new Date(liveTelemetry.timestamp).toLocaleTimeString() : "SYNCED"
  } : (filteredLogs.length > 0 ? filteredLogs[0] : {
    raw_ir: "2.20",
    ab_corrected: "2.40",
    bc_corrected: "2.42",
    ca_corrected: "2.38",
    ag_corrected: "2.25",
    bg_corrected: "2.28",
    cg_corrected: "2.20",
    temperature: "38.5",
    test_voltage: 1000,
    minutes: 1.0,
    motor_status: "NORMAL",
    formattedDate: "AWAITING TEST"
  });

  const currentEval = selectedMotor ? evaluateMotorStatus(
    parseFloat(latest.cg_corrected || latest.raw_ir), 
    parseFloat(latest.temperature), 
    selectedMotor.rated_voltage
  ) : { isSafe: true, ir40: 2.20, irMin: 1.38 };

  const handleExecuteAutomatedTest = async (e) => {
    e.preventDefault();
    if (!selectedMotor) return;
    setTestExecutionError('');
    setIsExecutingTest(true);

    try {
      await logTestReading({
        motorId: selectedMotor.id,
        raw_ab: Number(simAB),
        raw_bc: Number(simBC),
        raw_ca: Number(simCA),
        raw_ag: Number(simAG),
        raw_bg: Number(simBG),
        raw_cg: Number(simCG),
        rawIR: Number(simCG),
        temperature: Number(simTemp),
        testVoltage: Number(simTestVoltage),
        minutes: Number(simMinutes),
        ratedVoltage: selectedMotor.rated_voltage,
        employeeId: currentUser.employeeId || currentUser.uid,
        operatorName: currentUser.fullname || currentUser.email,
        ncAuxSafe: simNcAux,
        zeroVoltageSafe: simZeroVolt
      });
      const updatedHistory = await fetchTelemetryHistory();
      setTelemetryLogs(updatedHistory);
    } catch (err) {
      setTestExecutionError(err.message);
    } finally {
      setIsExecutingTest(false);
    }
  };

  const handleProvisionEmployee = async (e) => {
    e.preventDefault();
    try {
      await provisionUserWithId(newEmpId, {
        fullname: newFullname,
        role: newRole,
        pin: newPin
      });
      setUserCreatedMessage(`SAVED: ${newFullname} (ID: ${newEmpId})`);
      setNewEmpId('');
      setNewFullname('');
      setNewPin('1234');
      const updated = await fetchRegisteredUsers();
      setRegisteredUsers(updated);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#fbf9f5] text-[#1c1917] selection:bg-purple-700 selection:text-white font-mono">
      
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between px-5 py-3 border-b-2 border-[#e2d8cd] bg-[#fbf9f5]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <img src="/yuta-logo.png" alt="Y.U.T.A." className="w-6 h-6 object-contain" />
          <div>
            <span className="text-xs font-black tracking-[0.25em] text-[#1c1917]">Y.U.T.A.</span>
            {selectedMotor && (
              <span className="text-[10px] font-bold text-purple-800 block uppercase leading-tight">
                {selectedMotor.motor_name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-[#57534e] uppercase">
            ID: {currentUser.employeeId || 'ADMIN'}
          </span>
          <button onClick={logout} className="p-1.5 text-[#57534e] hover:text-rose-700 transition" title="Sign Out">
            <LogOutIcon className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </header>

      {/* Desktop Monolithic Sidebar */}
      <aside className="hidden md:flex w-64 border-r-2 border-[#e2d8cd] bg-[#f8f5ee] flex-col justify-between p-6 shrink-0">
        <div className="space-y-8">
          <div className="border-b-2 border-[#e2d8cd] pb-5">
            <div className="flex items-center gap-2.5">
              <img src="/yuta-logo.png" alt="Y.U.T.A." className="w-7 h-7 object-contain" />
              <h1 className="text-base font-black tracking-[0.25em]">Y.U.T.A.</h1>
            </div>
            <p className="text-xs font-bold tracking-[0.2em] text-[#57534e] uppercase mt-1">TELEMETRY SYSTEM</p>
          </div>

          {selectedMotor && (
            <div className="p-3 bg-[#ede5d8] border border-[#cbd5e1]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black tracking-widest text-purple-800 uppercase">ACTIVE STATION</span>
                <button onClick={handleCloseActiveMotor} className="text-xs text-[#57534e] hover:text-[#1c1917] font-bold cursor-pointer">✕</button>
              </div>
              <p className="text-xs font-black uppercase truncate mt-1">{selectedMotor.motor_name}</p>
              <p className="text-[10px] font-bold text-[#57534e] truncate">{selectedMotor.location}</p>
            </div>
          )}

          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full text-left py-2.5 px-3 text-xs tracking-[0.18em] transition-all flex items-center justify-between cursor-pointer ${
                    isActive 
                      ? 'bg-[#ede5d8] text-[#1c1917] border-l-4 border-purple-700 pl-4 font-black' 
                      : 'text-[#57534e] hover:text-[#1c1917] hover:bg-[#f3eee6] font-bold'
                  } ${item.section === 'station' ? 'pl-5' : ''}`}
                >
                  <span>{item.section === 'station' ? `↳ ${item.label}` : item.label}</span>
                  {isActive && <span className="text-xs text-purple-700 font-black">●</span>}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t-2 border-[#e2d8cd] pt-4">
          <div className="flex items-center justify-between">
            <div className="overflow-hidden pr-2">
              <p className="text-xs font-bold truncate">{currentUser.fullname || currentUser.email}</p>
              <span className="text-[10px] font-bold tracking-widest text-purple-700 uppercase mt-0.5 block">
                ID: {currentUser.employeeId || 'ADMIN-01'} [{currentUser.role}]
              </span>
            </div>
            <button onClick={logout} className="text-[#57534e] hover:text-[#1c1917] transition p-1 cursor-pointer">
              <LogOut className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Exhibition Workspace */}
      <main className="flex-1 p-5 sm:p-10 lg:p-12 overflow-y-auto pb-28 md:pb-12 max-h-screen">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: FLEET OVERVIEW */}
          {activeTab === 'fleet' && (
            <motion.div key="fleet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-6xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 border-b-2 border-[#e2d8cd] pb-6">
                <div>
                  <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">FLEET MONITOR</span>
                  <h2 className="text-3xl font-extrabold text-[#1c1917] tracking-tight mt-1">Water Pump Stations</h2>
                  <p className="text-xs text-[#44403c] font-bold mt-1">Select a station to open real-time 6-line insulation diagnostics</p>
                </div>
                {isAdmin && (
                  <button 
                    onClick={() => setShowAddMotorModal(true)}
                    className="px-4 py-2 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-bold tracking-widest uppercase transition flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> ADD MOTOR
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {motors.map((m) => {
                  const isMock = m.id === 'motor-mock';
                  return (
                    <div 
                      key={m.id}
                      onClick={() => handleSelectMotor(m)}
                      className={`border-2 p-6 flex flex-col justify-between transition-all cursor-pointer group shadow-sm active:scale-[0.99] ${
                        isMock 
                          ? 'border-purple-600 bg-purple-50/40 hover:bg-purple-50' 
                          : 'border-[#e2d8cd] bg-[#f8f5ee] hover:border-purple-700 hover:bg-[#faf7f2]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          {isMock ? (
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-900 bg-purple-200 px-2 py-0.5 border border-purple-400 flex items-center gap-1">
                              <Radio className="w-3 h-3 animate-pulse" /> SIMULATOR ACTIVE
                            </span>
                          ) : (
                            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 border border-emerald-300 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" /> OPERATIONAL
                            </span>
                          )}
                          <span className="text-[11px] font-bold text-[#57534e]">{m.rated_voltage} VAC</span>
                        </div>

                        <h3 className="text-lg font-black text-[#1c1917] uppercase tracking-wide group-hover:text-purple-700 transition">
                          {m.motor_name}
                        </h3>
                        <p className="text-xs font-bold text-[#57534e] uppercase mt-1">{m.location}</p>
                      </div>

                      <div className="mt-8 pt-4 border-t-2 border-[#e2d8cd] flex items-center justify-between text-xs font-black text-purple-700 group-hover:translate-x-1 transition-transform">
                        <span>{isMock ? "VIEW LIVE STREAM & LOGS" : "OPEN STATION"}</span>
                        <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* TAB 2: MONITOR WORKSPACE */}
          {activeTab === 'overview' && selectedMotor && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-6xl mx-auto">
              <button onClick={handleCloseActiveMotor} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-[#57534e] hover:text-[#1c1917] uppercase cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> FLEET OVERVIEW
              </button>

              <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4 border-b-2 border-[#e2d8cd] pb-6">
                <div>
                  <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">DIAGNOSTIC WORKSPACE</span>
                  <h2 className="text-3xl font-extrabold tracking-tight mt-1">{selectedMotor.motor_name}</h2>
                  <p className="text-xs font-bold text-[#44403c] mt-1 uppercase">
                    {selectedMotor.location} / {selectedMotor.rated_voltage} VAC 3-PHASE
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => exportTelemetryToCSV(filteredLogs, selectedMotor)} className="px-4 py-2 border-2 border-[#cbd5e1] bg-[#f3eee6] text-xs font-bold tracking-widest uppercase hover:bg-[#ede5d8] transition cursor-pointer">
                    EXPORT CSV
                  </button>
                  <button onClick={() => exportMaintenanceReportPDF(filteredLogs, selectedMotor, [])} className="px-4 py-2 bg-[#1c1917] text-[#fbf9f5] text-xs font-bold tracking-widest uppercase hover:bg-black transition cursor-pointer">
                    DOWNLOAD PDF
                  </button>
                </div>
              </header>

              {/* Gauges Matrix including NOMINAL DATA BOX */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                
                {/* 1. Evaluation Status */}
                <div className="border-2 border-[#e2d8cd] p-5 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.15em] text-[#57534e] uppercase block">EVALUATION</span>
                  <div className="mt-3">
                    <span className={`text-xl font-black ${currentEval.isSafe ? 'text-emerald-800' : 'text-rose-700'}`}>
                      {currentEval.isSafe ? 'NORMAL' : 'MAINT. REQ'}
                    </span>
                  </div>
                  <p className="text-[10px] font-bold text-[#78716c] uppercase mt-3">IEEE STD 43-2013</p>
                </div>

                {/* 2. NOMINAL DATA BOX (Positioned next to Status) */}
                <div className="border-2 border-purple-300 p-5 bg-purple-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold tracking-[0.15em] text-purple-900 uppercase">NOMINAL DATA</span>
                    <Zap className="w-3.5 h-3.5 text-purple-700" />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-bold text-[#57534e]">VOLTAGE:</span>
                      <span className="text-base font-black text-purple-900">{latest.test_voltage}V DC</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-bold text-[#57534e]">DURATION:</span>
                      <span className="text-sm font-black text-purple-900">{latest.minutes} MIN</span>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-purple-700 uppercase mt-2">UT501A INJECTED</p>
                </div>

                {/* 3. Min Line Reading */}
                <div className="border-2 border-[#e2d8cd] p-5 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.15em] text-[#57534e] uppercase block">MIN IR (40°C)</span>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black tracking-tight">{currentEval.ir40}</span>
                    <span className="text-xs text-purple-700 font-black">MΩ</span>
                  </div>
                  <p className="text-[10px] font-bold text-[#78716c] uppercase mt-3">LOWEST OF 6 LINES</p>
                </div>

                {/* 4. Threshold Limit */}
                <div className="border-2 border-[#e2d8cd] p-5 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.15em] text-[#57534e] uppercase block">IEEE LIMIT</span>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black tracking-tight">{currentEval.irMin}</span>
                    <span className="text-xs font-black text-[#57534e]">MΩ</span>
                  </div>
                  <p className="text-[10px] font-bold text-[#78716c] uppercase mt-3">kV + 1 THRESHOLD</p>
                </div>

                {/* 5. Temperature */}
                <div className="border-2 border-[#e2d8cd] p-5 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.15em] text-[#57534e] uppercase block">TEMP PROBE</span>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black tracking-tight">{latest.temperature}</span>
                    <span className="text-xs font-black text-[#57534e]">°C</span>
                  </div>
                  <p className="text-[10px] font-bold text-[#78716c] uppercase mt-3">DS18B20 SENSOR</p>
                </div>
              </div>

              {/* 6-Line Degradation Timeline with Phase & Voltage Controls */}
              <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee] space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#e2d8cd]">
                  <div>
                    <h3 className="text-sm font-black tracking-[0.2em] uppercase">6-LINE DEGRADATION TIMELINE</h3>
                    <p className="text-xs font-bold text-[#57534e] mt-0.5">Filter by Phase-Phase (A-B, B-C, C-A), Phase-Ground (A-G, B-G, C-G) or Nominal Voltage</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
                    
                    {/* Line Group Filter */}
                    <div className="flex items-center gap-1 bg-[#ede5d8] p-1 border border-[#cbd5e1]">
                      <span className="text-[10px] text-[#57534e] px-2">PATHS:</span>
                      <button
                        onClick={() => setLineFilterGroup('ALL')}
                        className={`px-2.5 py-1 text-[11px] font-black cursor-pointer transition ${
                          lineFilterGroup === 'ALL' ? 'bg-purple-700 text-white' : 'text-[#57534e] hover:text-[#1c1917]'
                        }`}
                      >
                        ALL 6
                      </button>
                      <button
                        onClick={() => setLineFilterGroup('PHASE_TO_PHASE')}
                        className={`px-2.5 py-1 text-[11px] font-black cursor-pointer transition ${
                          lineFilterGroup === 'PHASE_TO_PHASE' ? 'bg-purple-700 text-white' : 'text-[#57534e] hover:text-[#1c1917]'
                        }`}
                      >
                        PHASE-PHASE
                      </button>
                      <button
                        onClick={() => setLineFilterGroup('PHASE_TO_GROUND')}
                        className={`px-2.5 py-1 text-[11px] font-black cursor-pointer transition ${
                          lineFilterGroup === 'PHASE_TO_GROUND' ? 'bg-purple-700 text-white' : 'text-[#57534e] hover:text-[#1c1917]'
                        }`}
                      >
                        PHASE-GROUND
                      </button>
                    </div>

                    {/* Voltage Filter Subset */}
                    <div className="flex items-center gap-1 bg-[#ede5d8] p-1 border border-[#cbd5e1]">
                      <span className="text-[10px] text-[#57534e] px-2">VOLTAGE:</span>
                      {['ALL', '100', '250', '500', '1000'].map(v => (
                        <button
                          key={v}
                          onClick={() => setVoltageFilter(v)}
                          className={`px-2 py-1 text-[11px] font-black cursor-pointer transition ${
                            voltageFilter === v ? 'bg-[#1c1917] text-white' : 'text-[#57534e] hover:text-[#1c1917]'
                          }`}
                        >
                          {v === 'ALL' ? 'ALL' : `${v}V`}
                        </button>
                      ))}
                    </div>

                  </div>
                </div>

                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartDataset}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#cbd5e1" vertical={false} />
                      <XAxis dataKey="formattedDate" stroke="#44403c" fontSize={11} />
                      <YAxis stroke="#44403c" fontSize={11} domain={[0, 'auto']} />
                      <Tooltip />
                      <Legend />
                      
                      {/* Phase-to-Phase Lines */}
                      {(lineFilterGroup === 'ALL' || lineFilterGroup === 'PHASE_TO_PHASE') && (
                        <>
                          <Line type="monotone" dataKey="ab_corrected" name="A-B MΩ" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="bc_corrected" name="B-C MΩ" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="ca_corrected" name="C-A MΩ" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                        </>
                      )}

                      {/* Phase-to-Ground Lines */}
                      {(lineFilterGroup === 'ALL' || lineFilterGroup === 'PHASE_TO_GROUND') && (
                        <>
                          <Line type="monotone" dataKey="ag_corrected" name="A-G MΩ" stroke="#d97706" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="bg_corrected" name="B-G MΩ" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="cg_corrected" name="C-G MΩ" stroke="#475569" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                        </>
                      )}
                      
                      <Line type="monotone" dataKey="ir_min" name="IEEE Limit" stroke="#dc2626" strokeWidth={2} strokeDasharray="2 2" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 6-Line Test Injection Module */}
              <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                <h3 className="text-sm font-black tracking-[0.2em] uppercase mb-4">INJECT 6-LINE TEST READINGS</h3>
                {testExecutionError && <div className="p-3 mb-4 bg-rose-100 border border-rose-300 text-rose-800 text-xs font-bold">{testExecutionError}</div>}
                
                <form onSubmit={handleExecuteAutomatedTest} className="space-y-4">
                  
                  <div className="border border-[#cbd5e1] p-3 bg-white space-y-3">
                    <span className="text-[11px] font-black text-purple-900 uppercase block">PHASE-TO-PHASE READINGS (MΩ)</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">A-B PHASE</label>
                        <input type="number" step="0.01" value={simAB} onChange={e => setSimAB(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">B-C PHASE</label>
                        <input type="number" step="0.01" value={simBC} onChange={e => setSimBC(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">C-A PHASE</label>
                        <input type="number" step="0.01" value={simCA} onChange={e => setSimCA(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                    </div>
                  </div>

                  <div className="border border-[#cbd5e1] p-3 bg-white space-y-3">
                    <span className="text-[11px] font-black text-amber-900 uppercase block">PHASE-TO-GROUND READINGS (MΩ)</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">A-G GROUND</label>
                        <input type="number" step="0.01" value={simAG} onChange={e => setSimAG(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">B-G GROUND</label>
                        <input type="number" step="0.01" value={simBG} onChange={e => setSimBG(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-[#44403c] block mb-1">C-G GROUND</label>
                        <input type="number" step="0.01" value={simCG} onChange={e => setSimCG(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                    <div>
                      <label className="text-[11px] font-bold text-[#44403c] block mb-1">TEST VOLTS</label>
                      <select value={simTestVoltage} onChange={e => setSimTestVoltage(Number(e.target.value))} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold">
                        <option value={100}>100V DC</option>
                        <option value={250}>250V DC</option>
                        <option value={500}>500V DC</option>
                        <option value={1000}>1000V DC</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-[#44403c] block mb-1">DURATION (MIN)</label>
                      <input type="number" step="0.5" value={simMinutes} onChange={e => setSimMinutes(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-[#44403c] block mb-1">TEMP (°C)</label>
                      <input type="number" step="0.1" value={simTemp} onChange={e => setSimTemp(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
                    </div>
                  </div>

                  <button type="submit" disabled={isExecutingTest} className="py-2.5 px-6 bg-[#1c1917] text-[#fbf9f5] text-xs font-bold tracking-widest uppercase hover:bg-black transition cursor-pointer">
                    {isExecutingTest ? "RECORDING..." : "COMMIT ALL 6 LINE READINGS"}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* TAB 3: LOGS & AUDIT */}
          {activeTab === 'telemetry' && selectedMotor && (
            <motion.div key="telemetry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 max-w-6xl mx-auto">
              <button onClick={handleCloseActiveMotor} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-[#57534e] hover:text-[#1c1917] uppercase cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> FLEET OVERVIEW
              </button>
              <div className="flex justify-between items-baseline">
                <h2 className="text-2xl font-black uppercase">Historical Audit: {selectedMotor.motor_name}</h2>
                <button onClick={() => exportTelemetryToCSV(filteredLogs, selectedMotor)} className="px-3 py-1.5 border border-[#cbd5e1] bg-[#f3eee6] text-xs font-bold uppercase hover:bg-[#ede5d8]">
                  EXPORT CSV
                </button>
              </div>

              <div className="border-2 border-[#e2d8cd] overflow-x-auto bg-[#f8f5ee]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#f3eee6] border-b-2 border-[#e2d8cd] uppercase text-[#44403c]">
                    <tr>
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Volts</th>
                      <th className="p-3">Duration</th>
                      <th className="p-3">A-B</th>
                      <th className="p-3">B-C</th>
                      <th className="p-3">C-A</th>
                      <th className="p-3">A-G</th>
                      <th className="p-3">B-G</th>
                      <th className="p-3">C-G</th>
                      <th className="p-3">Temp</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2d8cd]">
                    {filteredLogs.length === 0 ? (
                      <tr><td colSpan="11" className="p-6 text-center text-[#78716c]">No historical logs for this station yet.</td></tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="p-3 text-[#57534e]">{log.formattedDate}</td>
                          <td className="p-3 font-bold text-purple-900">{log.test_voltage}V</td>
                          <td className="p-3">{log.minutes} min</td>
                          <td className="p-3">{log.ab_corrected} MΩ</td>
                          <td className="p-3">{log.bc_corrected} MΩ</td>
                          <td className="p-3">{log.ca_corrected} MΩ</td>
                          <td className="p-3">{log.ag_corrected} MΩ</td>
                          <td className="p-3">{log.bg_corrected} MΩ</td>
                          <td className="p-3">{log.cg_corrected} MΩ</td>
                          <td className="p-3">{log.temperature} °C</td>
                          <td className="p-3 font-bold text-emerald-800">{log.motor_status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* TAB 4: SAFETY INTERLOCKS */}
          {activeTab === 'safety' && selectedMotor && (
            <motion.div key="safety" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 max-w-4xl mx-auto">
              <button onClick={handleCloseActiveMotor} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-[#57534e] hover:text-[#1c1917] uppercase cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> FLEET OVERVIEW
              </button>
              <h2 className="text-2xl font-black uppercase">Safety Interlocks: {selectedMotor.motor_name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs uppercase font-bold text-[#57534e]">INTERLOCK 01</span>
                  <h3 className="text-sm font-black mt-1">NC AUXILIARY CONTACT</h3>
                  <p className="text-xs text-[#57534e] mt-2">Monitors contactor disconnect state to ensure zero backfeed potential.</p>
                  <p className="text-xs font-black text-emerald-800 mt-4">STATUS: CONFIRMED DE-ENERGIZED</p>
                </div>
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs uppercase font-bold text-[#57534e]">INTERLOCK 02</span>
                  <h3 className="text-sm font-black mt-1">ZMPT101B VOLTAGE SENSOR</h3>
                  <p className="text-xs text-[#57534e] mt-2">Galvanically isolated sensing verifying zero residual line voltage.</p>
                  <p className="text-xs font-black text-emerald-800 mt-4">STATUS: 0.00 VAC (SAFE)</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 5: USERS & ACCESS */}
          {activeTab === 'settings' && isAdmin && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-4xl mx-auto">
              <div className="border-b-2 border-[#e2d8cd] pb-6">
                <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">EMPLOYEE DIRECTORY</span>
                <h2 className="text-3xl font-extrabold tracking-tight mt-1">User & Operator Accounts</h2>
              </div>

              <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee] space-y-6">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider">REGISTER OPERATOR BY EMPLOYEE ID</h3>
                  <p className="text-xs text-[#57534e] mt-1">Authorized personnel use their official company ID number to authenticate on plant terminals.</p>
                </div>

                {userCreatedMessage && (
                  <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-bold">
                    {userCreatedMessage}
                  </div>
                )}

                <form onSubmit={handleProvisionEmployee} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">EMPLOYEE ID #</label>
                      <input 
                        type="text" required value={newEmpId} onChange={e => setNewEmpId(e.target.value)} 
                        placeholder="EMP-2026-081"
                        className="w-full border-b border-[#cbd5e1] py-1.5 text-xs bg-transparent font-bold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">FULL NAME</label>
                      <input 
                        type="text" required value={newFullname} onChange={e => setNewFullname(e.target.value)} 
                        placeholder="Operator Name"
                        className="w-full border-b border-[#cbd5e1] py-1.5 text-xs bg-transparent font-bold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">DEFAULT PIN</label>
                      <input 
                        type="password" required value={newPin} onChange={e => setNewPin(e.target.value)} 
                        className="w-full border-b border-[#cbd5e1] py-1.5 text-xs bg-transparent font-bold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">ROLE</label>
                      <select value={newRole} onChange={e => setNewRole(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1.5 text-xs bg-transparent font-bold">
                        <option value="Employee">EMPLOYEE</option>
                        <option value="Admin">ADMINISTRATOR</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="py-2.5 px-6 bg-[#1c1917] text-[#fbf9f5] text-xs font-bold tracking-widest uppercase hover:bg-black transition cursor-pointer">
                    PROVISION ID
                  </button>
                </form>

                <div className="pt-6 border-t-2 border-[#e2d8cd]">
                  <h4 className="text-xs font-black uppercase text-[#44403c] mb-3">DATABASE REGISTERED PERSONNEL</h4>
                  <div className="divide-y divide-[#e2d8cd]">
                    {registeredUsers.length === 0 ? (
                      <p className="text-xs text-[#78716c]">No operators provisioned in database.</p>
                    ) : (
                      registeredUsers.map((u) => (
                        <div key={u.id} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-black text-[#1c1917]">{u.fullname}</p>
                            <span className="text-[11px] font-bold text-purple-900 bg-purple-100 px-2 py-0.5 border border-purple-200">
                              ID: {u.employeeId || u.id}
                            </span>
                          </div>
                          <span className="uppercase font-black text-xs text-[#57534e]">{u.role}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Mobile Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#fbf9f5]/95 backdrop-blur-lg border-t-2 border-[#e2d8cd] px-2 py-1.5">
        <div className="flex items-center justify-around max-w-lg mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const displayLabel = item.mobileLabel || item.label;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center py-1.5 px-3 rounded-lg transition-all active:scale-90 ${
                  isActive ? 'text-purple-800' : 'text-[#78716c] hover:text-[#1c1917]'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
                  {isActive && (
                    <motion.div 
                      layoutId="bottomTabIndicator"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-700" 
                    />
                  )}
                </div>
                <span className={`text-[9px] uppercase tracking-wider mt-1.5 ${isActive ? 'font-black text-[#1c1917]' : 'font-bold text-[#78716c]'}`}>
                  {displayLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Admin Add Motor Modal */}
      {showAddMotorModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#fbf9f5] border-2 border-[#cbd5e1] p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-sm tracking-[0.2em] font-black uppercase mb-4">REGISTER PUMP STATION</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              await createMotorAsset({ motorName: newMotorName, location: newMotorLocation, ratedVoltage: newMotorVoltage });
              setShowAddMotorModal(false);
              setNewMotorName('');
              setNewMotorLocation('');
            }} className="space-y-4">
              <div>
                <label className="text-xs font-bold block mb-1">STATION NAME</label>
                <input type="text" required value={newMotorName} onChange={e => setNewMotorName(e.target.value)} placeholder="WATER PUMP 04" className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">LOCATION</label>
                <input type="text" required value={newMotorLocation} onChange={e => setNewMotorLocation(e.target.value)} placeholder="BASEMENT B" className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold" />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">RATED VOLTAGE</label>
                <select value={newMotorVoltage} onChange={e => setNewMotorVoltage(Number(e.target.value))} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent font-bold">
                  {IEEE_VOLTAGE_THRESHOLDS.map(t => (
                    <option key={t.voltage} value={t.voltage}>{t.voltage} VAC (BASELINE: {t.irMin} MΩ)</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-[#e2d8cd]">
                <button type="button" onClick={() => setShowAddMotorModal(false)} className="py-2 px-4 text-xs font-bold">CANCEL</button>
                <button type="submit" className="py-2 px-5 bg-[#1c1917] text-[#fbf9f5] text-xs font-bold uppercase">SAVE</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
