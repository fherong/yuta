import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { evaluateMotorStatus, IEEE_VOLTAGE_THRESHOLDS } from './utils/ieeeStandards';
import { 
  subscribeToMotors,
  logTestReading, 
  createMotorAsset,
  updateMotorAsset,
  deleteMotorAsset,
  provisionUserWithId, 
  fetchRegisteredUsers,
  subscribeToLiveTelemetry,
  fetchTelemetryHistory
} from './services/telemetryService';
import { exportTelemetryToCSV, exportMaintenanceReportPDF } from './utils/reportGenerator';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LogOut, 
  Edit3,
  Trash2,
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
  LogOut as LogOutIcon
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function App() {
  const { currentUser, logout, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('fleet');
  
  // Default Fleet
  const defaultMotors = [
    { id: 'motor-mock', motor_name: 'MOCK GATEWAY TEST RIG', location: 'LAB BENCH (SIMULATOR)', rated_voltage: 380 },
    { id: 'motor-001', motor_name: 'WATER PUMP 01', location: 'PUMP ROOM BASEMENT', rated_voltage: 480 },
    { id: 'motor-002', motor_name: 'BOOSTER PUMP 02', location: 'HVAC ROOFTOP', rated_voltage: 380 },
    { id: 'motor-003', motor_name: 'DRAINAGE PUMP 03', location: 'SUMP BASIN', rated_voltage: 240 }
  ];

  const [motors, setMotors] = useState(defaultMotors);
  const [selectedMotor, setSelectedMotor] = useState(null);

  // Real-time Streams
  const [liveTelemetry, setLiveTelemetry] = useState(null);
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [registeredUsers, setRegisteredUsers] = useState([]);

  // Modals & User Forms
  const [showAddMotorModal, setShowAddMotorModal] = useState(false);
  const [newMotorName, setNewMotorName] = useState('');
  const [newMotorLocation, setNewMotorLocation] = useState('');
  const [newMotorVoltage, setNewMotorVoltage] = useState(380);

  // Manual Safety Simulation Trigger
  const [simRawIR, setSimRawIR] = useState(2.35);
  const [simTemp, setSimTemp] = useState(38.5);
  const [simNcAux, setSimNcAux] = useState(true);
  const [simZeroVolt, setSimZeroVolt] = useState(true);
  const [isExecutingTest, setIsExecutingTest] = useState(false);
  const [testExecutionError, setTestExecutionError] = useState('');

  // Admin User Provisioning by Employee ID
  const [newEmpId, setNewEmpId] = useState('');
  const [newFullname, setNewFullname] = useState('');
  const [newPin, setNewPin] = useState('1234');
  const [newRole, setNewRole] = useState('Employee');
  const [userCreatedMessage, setUserCreatedMessage] = useState('');

  // Dynamic tabs mapping: Icon used for mobile dock, Text used on desktop
  const navItems = [
    { id: 'fleet', label: 'FLEET', icon: LayoutGrid, section: 'global' },
    ...(selectedMotor ? [
      { id: 'overview', label: 'MONITOR', icon: Activity, section: 'station' },
      { id: 'telemetry', label: 'LOGS', icon: FileText, section: 'station' },
      { id: 'safety', label: 'INTERLOCKS', icon: ShieldCheck, section: 'station' },
    ] : []),
    { id: 'settings', label: 'USERS & ACCESS', mobileLabel: 'ACCESS', icon: Users, section: 'global' },
  ];

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
        const formatted = historyData.map((item) => ({
          id: item.id || item.timestamp,
          motor_id: item.motorId || 'motor-mock',
          raw_ir: Number(item.rawIR || 0),
          corrected_ir: Number(item.correctedIR || 0),
          temperature: Number(item.temperatureC || 0),
          rated_voltage: Number(item.motorVoltage || 380),
          ir_min: Number(item.thresholdIR || 1.38),
          motor_status: item.status || 'Normal',
          operator_id: item.employeeId || 'GATEWAY-01',
          operator_name: item.operatorName || 'Python Gateway AMU',
          formattedDate: item.timestamp 
            ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : 'LIVE'
        }));
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

  const latest = (selectedMotor?.id === 'motor-mock' && liveTelemetry) ? {
    raw_ir: Number(liveTelemetry.rawIR || 0).toFixed(2),
    corrected_ir: Number(liveTelemetry.correctedIR || 0).toFixed(2),
    temperature: Number(liveTelemetry.temperatureC || 0).toFixed(1),
    motor_status: liveTelemetry.status || "Normal",
    formattedDate: liveTelemetry.timestamp ? new Date(liveTelemetry.timestamp).toLocaleTimeString() : "SYNCED"
  } : (filteredLogs.length > 0 ? filteredLogs[0] : {
    raw_ir: "2.20",
    corrected_ir: "2.20",
    temperature: "38.5",
    motor_status: "Normal",
    formattedDate: "AWAITING TEST"
  });

  const currentEval = selectedMotor ? evaluateMotorStatus(
    parseFloat(latest.raw_ir), 
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
        rawIR: simRawIR,
        temperature: simTemp,
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
    <div className="flex flex-col md:flex-row min-h-screen bg-[#fbf9f5] text-[#1c1917] selection:bg-purple-700 selection:text-white">
      
      {/* Tablet / Mobile Header Bar */}
      <header className="md:hidden flex items-center justify-between px-5 py-3 border-b-2 border-[#e2d8cd] bg-[#fbf9f5]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <img src="/yuta-logo.png" alt="Y.U.T.A." className="w-6 h-6 object-contain" />
          <div>
            <span className="text-xs font-mono font-black tracking-[0.25em] text-[#1c1917]">Y.U.T.A.</span>
            {selectedMotor && (
              <span className="text-[10px] font-mono font-bold text-purple-800 block uppercase leading-tight">
                {selectedMotor.motor_name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-[10px] font-bold text-[#57534e] uppercase">
            ID: {currentUser.employeeId || 'ADMIN'}
          </span>
          <button 
            onClick={logout} 
            className="p-1.5 text-[#57534e] hover:text-rose-700 transition" 
            title="Disconnect"
          >
            <LogOutIcon className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </header>

      {/* Desktop Monolithic Sidebar */}
      <aside className="hidden md:flex w-64 border-r-2 border-[#e2d8cd] bg-[#f8f5ee] flex-col justify-between p-6 shrink-0 font-mono">
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
                <button onClick={handleCloseActiveMotor} className="text-xs text-[#57534e] hover:text-[#1c1917] font-bold cursor-pointer" title="Exit station">✕</button>
              </div>
              <p className="text-xs font-black uppercase truncate mt-1">{selectedMotor.motor_name}</p>
              <p className="text-[10px] font-bold text-[#57534e] truncate">{selectedMotor.location}</p>
            </div>
          )}

          {/* Desktop Nav Items */}
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
            <button onClick={logout} className="text-[#57534e] hover:text-[#1c1917] transition p-1 cursor-pointer" title="Sign Out">
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
            <motion.div key="fleet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-6xl mx-auto font-mono">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 border-b-2 border-[#e2d8cd] pb-6">
                <div>
                  <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">FLEET MONITOR</span>
                  <h2 className="text-3xl font-extrabold text-[#1c1917] tracking-tight mt-1">Water Pump Stations</h2>
                  <p className="text-xs text-[#44403c] font-bold mt-1">Tap a pump station to unlock live monitoring, sensor logs, and safety interlocks</p>
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

          {/* TAB 2: MONITOR (STATION SCOPED) */}
          {activeTab === 'overview' && selectedMotor && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-10 max-w-6xl mx-auto font-mono">
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

              {/* Gauges Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.2em] text-[#57534e] uppercase block">EVALUATION</span>
                  <div className="mt-4">
                    <span className={`text-2xl font-black ${currentEval.isSafe ? 'text-emerald-800' : 'text-rose-700'}`}>
                      {currentEval.isSafe ? 'NORMAL' : 'MAINT. REQ'}
                    </span>
                  </div>
                  <p className="text-[11px] font-bold text-[#78716c] uppercase mt-4">IEEE STD 43-2013</p>
                </div>

                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.2em] text-[#57534e] uppercase block">NORMALIZED (40°C)</span>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tracking-tight">{currentEval.ir40}</span>
                    <span className="text-xs text-purple-700 font-black">MΩ</span>
                  </div>
                  <p className="text-[11px] font-bold text-[#78716c] uppercase mt-4">RAW: {latest.raw_ir} MΩ</p>
                </div>

                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.2em] text-[#57534e] uppercase block">BASELINE LIMIT</span>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tracking-tight">{currentEval.irMin}</span>
                    <span className="text-xs font-black text-[#57534e]">MΩ</span>
                  </div>
                  <p className="text-[11px] font-bold text-[#78716c] uppercase mt-4">kV + 1 THRESHOLD</p>
                </div>

                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-bold tracking-[0.2em] text-[#57534e] uppercase block">TEMPERATURE</span>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tracking-tight">{latest.temperature}</span>
                    <span className="text-xs font-black text-[#57534e]">°C</span>
                  </div>
                  <p className="text-[11px] font-bold text-[#78716c] uppercase mt-4">DS18B20 PROBE</p>
                </div>
              </div>

              {/* Degradation Chart */}
              <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                <div className="flex justify-between items-baseline mb-4">
                  <h3 className="text-sm font-black tracking-[0.2em] uppercase">DEGRADATION TIMELINE</h3>
                  <span className="text-xs font-bold text-[#57534e]">{filteredLogs.length} SAMPLES</span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredLogs}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#cbd5e1" vertical={false} />
                      <XAxis dataKey="formattedDate" stroke="#44403c" fontSize={11} />
                      <YAxis stroke="#44403c" fontSize={11} domain={[0, 'auto']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="corrected_ir" name="Normalized IR" stroke="#6d28d9" strokeWidth={3} />
                      <Line type="monotone" dataKey="ir_min" name="Minimum Allowed" stroke="#dc2626" strokeWidth={2} strokeDasharray="4 4" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Test Injection Sequence */}
              <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                <h3 className="text-sm font-black tracking-[0.2em] uppercase mb-4">MANUAL TEST INJECTION</h3>
                {testExecutionError && <div className="p-3 mb-4 bg-rose-100 border border-rose-300 text-rose-800 text-xs font-bold">{testExecutionError}</div>}
                <form onSubmit={handleExecuteAutomatedTest} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">RAW IR (MΩ)</label>
                      <input type="number" step="0.01" value={simRawIR} onChange={e => setSimRawIR(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">TEMP (°C)</label>
                      <input type="number" step="0.1" value={simTemp} onChange={e => setSimTemp(e.target.value)} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">NC AUXILIARY</label>
                      <select value={simNcAux ? "safe" : "unsafe"} onChange={e => setSimNcAux(e.target.value === "safe")} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent">
                        <option value="safe">DISCONNECTED (SAFE)</option>
                        <option value="unsafe">CLOSED (LIVE)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#44403c] block mb-1">ZMPT101B SENSOR</label>
                      <select value={simZeroVolt ? "safe" : "unsafe"} onChange={e => setSimZeroVolt(e.target.value === "safe")} className="w-full border-b border-[#cbd5e1] py-1 text-xs bg-transparent">
                        <option value="safe">0.00 VAC (ZERO V)</option>
                        <option value="unsafe">VOLTAGE DETECTED</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" disabled={isExecutingTest} className="py-2.5 px-6 bg-[#1c1917] text-[#fbf9f5] text-xs font-bold tracking-widest uppercase hover:bg-black transition cursor-pointer">
                    {isExecutingTest ? "RECORDING..." : "COMMIT TEST RECORD"}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* TAB 3: LOGS (STATION SCOPED) */}
          {activeTab === 'telemetry' && selectedMotor && (
            <motion.div key="telemetry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 max-w-6xl mx-auto font-mono">
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
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Raw IR</th>
                      <th className="p-4">Temp</th>
                      <th className="p-4">Normalized (40°C)</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Operator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2d8cd]">
                    {filteredLogs.length === 0 ? (
                      <tr><td colSpan="6" className="p-6 text-center text-[#78716c]">No historical logs for this station yet.</td></tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="p-4 text-[#57534e]">{log.formattedDate}</td>
                          <td className="p-4">{log.raw_ir} MΩ</td>
                          <td className="p-4">{log.temperature} °C</td>
                          <td className="p-4 font-black text-purple-900">{log.corrected_ir} MΩ</td>
                          <td className="p-4 font-bold text-emerald-800">{log.motor_status}</td>
                          <td className="p-4 text-[#57534e]">{log.operator_name} (ID: {log.operator_id})</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* TAB 4: INTERLOCKS (STATION SCOPED) */}
          {activeTab === 'safety' && selectedMotor && (
            <motion.div key="safety" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 max-w-4xl mx-auto font-mono">
              <button onClick={handleCloseActiveMotor} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-[#57534e] hover:text-[#1c1917] uppercase cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> FLEET OVERVIEW
              </button>
              <h2 className="text-2xl font-black uppercase">Safety Interlocks: {selectedMotor.motor_name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs uppercase font-bold text-[#57534e]">INTERLOCK 01</span>
                  <h3 className="text-sm font-black mt-1">NC AUXILIARY CONTACT</h3>
                  <p className="text-xs text-[#57534e] mt-2">Monitors main disconnect physical starter contact state.</p>
                  <p className="text-xs font-black text-emerald-800 mt-4">STATUS: CONFIRMED DE-ENERGIZED</p>
                </div>
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs uppercase font-bold text-[#57534e]">INTERLOCK 02</span>
                  <h3 className="text-sm font-black mt-1">ZMPT101B SENSING</h3>
                  <p className="text-xs text-[#57534e] mt-2">Active AC terminal detection verifying residual voltage.</p>
                  <p className="text-xs font-black text-emerald-800 mt-4">STATUS: 0.00 VAC (SAFE)</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 5: USERS & ACCESS (ADMIN) */}
          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-4xl mx-auto font-mono">
              <div className="border-b-2 border-[#e2d8cd] pb-6">
                <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">EMPLOYEE DIRECTORY</span>
                <h2 className="text-3xl font-extrabold tracking-tight mt-1">User & Operator Accounts</h2>
              </div>

              {isAdmin ? (
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
              ) : (
                <div className="p-6 border-2 border-[#e2d8cd] bg-[#f8f5ee] text-xs font-bold text-[#57534e]">
                  Technician status. Account provisioning restricted to administrators.
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Instagram-Style Bottom Navigation Dock (Tablet & Mobile only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#fbf9f5]/95 backdrop-blur-lg border-t-2 border-[#e2d8cd] px-2 py-1.5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] font-mono">
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 font-mono">
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