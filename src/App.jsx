import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { evaluateMotorStatus, IEEE_VOLTAGE_THRESHOLDS } from './utils/ieeeStandards';
import { 
  subscribeToMotors,
  subscribeToMotorTelemetry, 
  subscribeToMotorAlerts, 
  logTestReading, 
  createMotorAsset,
  updateMotorAsset,
  deleteMotorAsset,
  provisionUserAccount, 
  fetchRegisteredUsers 
} from './services/telemetryService';
import { exportTelemetryToCSV, exportMaintenanceReportPDF } from './utils/reportGenerator';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  LogOut, 
  X, 
  Menu,
  Edit3,
  Trash2
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function App() {
  const { currentUser, logout, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Factory Motors Fleet
  const [motors, setMotors] = useState([
    { id: 'motor-001', motor_name: 'WATER PUMP 01', location: 'PUMP ROOM BASEMENT', rated_voltage: 480 },
    { id: 'motor-002', motor_name: 'BOOSTER PUMP 02', location: 'HVAC ROOFTOP', rated_voltage: 380 },
    { id: 'motor-003', motor_name: 'DRAINAGE PUMP 03', location: 'SUMP BASIN', rated_voltage: 240 }
  ]);
  const [selectedMotorId, setSelectedMotorId] = useState('motor-001');

  // Real-time Streams
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [registeredUsers, setRegisteredUsers] = useState([]);

  // Modals & User Forms
  const [showAddMotorModal, setShowAddMotorModal] = useState(false);
  const [newMotorName, setNewMotorName] = useState('');
  const [newMotorLocation, setNewMotorLocation] = useState('');
  const [newMotorVoltage, setNewMotorVoltage] = useState(480);

  // Edit Motor State
  const [editingMotor, setEditingMotor] = useState(null);
  const [showEditMotorModal, setShowEditMotorModal] = useState(false);

  // Manual Safety Simulation Trigger
  const [simRawIR, setSimRawIR] = useState(2.35);
  const [simTemp, setSimTemp] = useState(38.5);
  const [simNcAux, setSimNcAux] = useState(true);
  const [simZeroVolt, setSimZeroVolt] = useState(true);
  const [isExecutingTest, setIsExecutingTest] = useState(false);
  const [testExecutionError, setTestExecutionError] = useState('');

  // Admin User Provisioning
  const [newFullname, setNewFullname] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('Employee');
  const [userCreatedMessage, setUserCreatedMessage] = useState('');

  const navItems = [
    { id: 'overview', label: 'MONITOR' },
    { id: 'telemetry', label: 'LOGS' },
    { id: 'safety', label: 'INTERLOCKS' },
    { id: 'settings', label: 'SYSTEM' },
  ];

  useEffect(() => {
    if (!currentUser) return;
    const unsubMotors = subscribeToMotors((data) => {
      if (data.length > 0) {
        setMotors(data);
        if (!data.some(m => m.id === selectedMotorId)) setSelectedMotorId(data[0].id);
      }
    });
    return () => unsubMotors();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !selectedMotorId) return;
    const unsubTelemetry = subscribeToMotorTelemetry(selectedMotorId, (data) => setTelemetryLogs(data));
    const unsubAlerts = subscribeToMotorAlerts(selectedMotorId, (alerts) => setActiveAlerts(alerts));
    if (isAdmin) fetchRegisteredUsers().then(setRegisteredUsers).catch(console.error);

    return () => {
      unsubTelemetry();
      unsubAlerts();
    };
  }, [currentUser, selectedMotorId, isAdmin]);

  if (!currentUser) return <Login />;

  const activeMotor = motors.find(m => m.id === selectedMotorId) || motors[0] || {
    id: 'motor-001',
    motor_name: 'WATER PUMP 01',
    location: 'PUMP ROOM BASEMENT',
    rated_voltage: 480
  };

  const latest = telemetryLogs.length > 0 ? telemetryLogs[telemetryLogs.length - 1] : {
    raw_ir: 2.20,
    corrected_ir: 2.20,
    temperature: 38.5,
    rated_voltage: activeMotor.rated_voltage,
    motor_status: "Normal",
    formattedDate: "AWAITING INSPECTION"
  };

  const currentEval = evaluateMotorStatus(latest.raw_ir, latest.temperature, activeMotor.rated_voltage);

  const handleExecuteAutomatedTest = async (e) => {
    e.preventDefault();
    setTestExecutionError('');
    setIsExecutingTest(true);

    try {
      await logTestReading({
        motorId: activeMotor.id,
        rawIR: simRawIR,
        temperature: simTemp,
        ratedVoltage: activeMotor.rated_voltage,
        userId: currentUser.uid,
        userName: currentUser.fullname || currentUser.email,
        ncAuxSafe: simNcAux,
        zeroVoltageSafe: simZeroVolt
      });
    } catch (err) {
      setTestExecutionError(err.message);
    } finally {
      setIsExecutingTest(false);
    }
  };

  const handleCreateMotor = async (e) => {
    e.preventDefault();
    try {
      const newId = await createMotorAsset({
        motorName: newMotorName,
        location: newMotorLocation,
        ratedVoltage: newMotorVoltage
      });
      setSelectedMotorId(newId);
      setShowAddMotorModal(false);
      setNewMotorName('');
      setNewMotorLocation('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenEditModal = (motor) => {
    setEditingMotor({
      id: motor.id,
      motor_name: motor.motor_name,
      location: motor.location,
      rated_voltage: motor.rated_voltage
    });
    setShowEditMotorModal(true);
  };

  const handleSaveMotorEdit = async (e) => {
    e.preventDefault();
    if (!editingMotor) return;
    try {
      await updateMotorAsset(editingMotor.id, {
        motorName: editingMotor.motor_name,
        location: editingMotor.location,
        ratedVoltage: editingMotor.rated_voltage
      });
      setShowEditMotorModal(false);
      setEditingMotor(null);
    } catch (err) {
      console.error("Failed to update motor:", err);
    }
  };

  const handleDeleteMotor = async (motorId, motorName) => {
    const confirmed = window.confirm(`Are you sure you want to remove ${motorName}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteMotorAsset(motorId);
      const remaining = motors.filter(m => m.id !== motorId);
      if (remaining.length > 0) {
        setSelectedMotorId(remaining[0].id);
      }
    } catch (err) {
      console.error("Failed to delete motor:", err);
    }
  };

  const handleProvisionUser = async (e) => {
    e.preventDefault();
    try {
      const generatedUid = `user-${Date.now()}`;
      await provisionUserAccount(generatedUid, {
        fullname: newFullname,
        email: newEmail,
        role: newRole
      });
      setUserCreatedMessage(`PROVISIONED: ${newFullname} (${newRole})`);
      setNewFullname('');
      setNewEmail('');
      const updated = await fetchRegisteredUsers();
      setRegisteredUsers(updated);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#fbf9f5] text-[#1c1917] selection:bg-purple-700 selection:text-white">
      
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-6 py-4 border-b-2 border-[#e2d8cd] bg-[#fbf9f5] sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <img src="/yuta-logo.png" alt="Y.U.T.A." className="w-6 h-6 object-contain" />
          <div>
            <span className="text-sm font-mono font-bold tracking-[0.2em] text-[#1c1917]">Y.U.T.A.</span>
            <span className="text-xs font-mono font-bold text-[#57534e] block uppercase">{activeMotor.motor_name}</span>
          </div>
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-[#44403c] hover:text-[#1c1917]"
        >
          {mobileMenuOpen ? <X className="w-5 h-5 stroke-[2.5]" /> : <Menu className="w-5 h-5 stroke-[2.5]" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="md:hidden bg-[#f3eee6] border-b-2 border-[#e2d8cd] p-6 space-y-5 z-30 shadow-md font-mono"
          >
            <div>
              <label className="text-xs font-bold tracking-widest text-[#44403c] uppercase block mb-2">TARGET ASSET</label>
              <select
                value={selectedMotorId}
                onChange={(e) => {
                  setSelectedMotorId(e.target.value);
                  setMobileMenuOpen(false);
                }}
                className="w-full bg-[#fbf9f5] border-2 border-[#cbd5e1] text-xs font-bold text-[#1c1917] py-3 px-3 rounded-none focus:outline-none"
              >
                {motors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.motor_name} ({m.rated_voltage}V)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-between items-center text-xs font-bold text-[#44403c] pt-4 border-t-2 border-[#e2d8cd]">
              <span>{currentUser.fullname || currentUser.email} [{currentUser.role}]</span>
              <button onClick={logout} className="text-purple-700 uppercase tracking-widest font-black">DISCONNECT</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monolithic Desktop Sidebar */}
      <aside className="hidden md:flex w-64 border-r-2 border-[#e2d8cd] bg-[#f8f5ee] flex-col justify-between p-6 shrink-0">
        <div className="space-y-8">
          {/* Brand Header */}
          <div className="border-b-2 border-[#e2d8cd] pb-5">
            <div className="flex items-center gap-2.5">
              <img src="/yuta-logo.png" alt="Y.U.T.A." className="w-7 h-7 object-contain" />
              <h1 className="font-mono text-base font-black tracking-[0.25em] text-[#1c1917]">Y.U.T.A.</h1>
            </div>
            <p className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase mt-1">TELEMETRY SYSTEM</p>
          </div>

          {/* Plant Asset Switcher */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#44403c] uppercase">ASSET</span>
              <span className="text-xs font-mono font-bold text-[#57534e]">{motors.length} UNITS</span>
            </div>
            <div className="relative">
              <select
                value={selectedMotorId}
                onChange={(e) => setSelectedMotorId(e.target.value)}
                className="w-full bg-[#fbf9f5] border-2 border-[#cbd5e1] hover:border-[#94a3b8] text-[#1c1917] text-xs font-mono font-bold py-2.5 px-3 pr-8 appearance-none focus:outline-none focus:border-purple-700 transition cursor-pointer rounded-none shadow-sm"
              >
                {motors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.motor_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#44403c] stroke-[2.5] absolute right-2.5 top-3 pointer-events-none" />
            </div>
            
            {isAdmin && (
              <button 
                onClick={() => setShowAddMotorModal(true)}
                className="w-full mt-2.5 py-2 border-2 border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-mono font-bold tracking-widest text-[#292524] uppercase transition cursor-pointer"
              >
                + ADD MOTOR
              </button>
            )}
          </div>

          {/* Navigation Items */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full text-left py-2.5 px-3 text-xs font-mono tracking-[0.18em] transition-all flex items-center justify-between cursor-pointer ${
                    isActive 
                      ? 'bg-[#ede5d8] text-[#1c1917] border-l-4 border-purple-700 pl-4 font-black' 
                      : 'text-[#57534e] hover:text-[#1c1917] hover:bg-[#f3eee6] font-bold'
                  }`}
                >
                  <span>{item.label}</span>
                  {isActive && <span className="text-xs text-purple-700 font-black">●</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Card */}
        <div className="border-t-2 border-[#e2d8cd] pt-4 font-mono">
          <div className="flex items-center justify-between">
            <div className="overflow-hidden pr-2">
              <p className="text-xs font-bold text-[#1c1917] truncate">{currentUser.fullname || currentUser.email}</p>
              <span className="text-[10px] font-bold tracking-widest text-purple-700 uppercase mt-0.5 block">
                {currentUser.role}
              </span>
            </div>
            <button onClick={logout} className="text-[#57534e] hover:text-[#1c1917] transition p-1 cursor-pointer" title="Sign Out">
              <LogOut className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Exhibition Workspace */}
      <main className="flex-1 p-6 sm:p-10 lg:p-12 overflow-y-auto pb-24 md:pb-12 max-h-screen">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: OVERVIEW HUD */}
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-10 max-w-6xl mx-auto">
              
              {/* Header */}
              <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4 border-b-2 border-[#e2d8cd] pb-6">
                <div>
                  <span className="text-xs font-mono font-bold tracking-[0.25em] text-[#57534e] uppercase">TELEMETRY DIAGNOSTIC</span>
                  <h2 className="text-3xl font-extrabold tracking-tight text-[#1c1917] mt-1">{activeMotor.motor_name}</h2>
                  <p className="text-xs font-mono font-bold text-[#44403c] mt-1 uppercase tracking-wider">
                    {activeMotor.location} / {activeMotor.rated_voltage} VAC 3-PHASE
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => exportTelemetryToCSV(telemetryLogs, activeMotor)}
                    className="px-4 py-2 border-2 border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-mono font-bold tracking-widest text-[#1c1917] uppercase transition cursor-pointer"
                  >
                    EXPORT CSV
                  </button>
                  <button 
                    onClick={() => exportMaintenanceReportPDF(telemetryLogs, activeMotor, activeAlerts)}
                    className="px-4 py-2 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-mono font-bold tracking-widest uppercase transition active:bg-neutral-800 shadow-sm cursor-pointer"
                  >
                    DOWNLOAD PDF
                  </button>
                </div>
              </header>

              {/* Active Alert Banner */}
              {activeAlerts.length > 0 && (
                <div className="p-4 border-2 border-rose-300 bg-rose-50 flex items-start justify-between">
                  <div>
                    <span className="text-xs font-mono tracking-widest text-rose-900 uppercase font-black block">
                      CRITICAL STATUS DEGRADATION
                    </span>
                    <p className="text-xs text-rose-950 mt-1 font-semibold">{activeAlerts[0].alert_message}</p>
                  </div>
                  <span className="text-xs font-mono font-bold text-rose-800 uppercase">{activeAlerts[0].timeFormatted}</span>
                </div>
              )}

              {/* Numbers Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                
                {/* Condition */}
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase block">STATUS</span>
                  <div className="mt-4">
                    {currentEval.isSafe ? (
                      <span className="text-2xl font-black text-emerald-800 tracking-wide">
                        NORMAL
                      </span>
                    ) : (
                      <span className="text-2xl font-black text-rose-700 tracking-wide">
                        MAINT. REQ
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#78716c] uppercase mt-4 tracking-wider">IEEE STD 43-2013</p>
                </div>

                {/* Normalized IR40 */}
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase block">NORMALIZED (40°C)</span>
                  <div className="mt-2 flex items-baseline gap-1.5 font-mono">
                    <span className="text-4xl font-black tracking-tight text-[#1c1917]">{currentEval.ir40}</span>
                    <span className="text-xs text-purple-700 font-black">MΩ</span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#78716c] uppercase mt-4 tracking-wider">RAW: {latest.raw_ir} MΩ</p>
                </div>

                {/* Minimum Allowed */}
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase block">BASELINE LIMIT</span>
                  <div className="mt-2 flex items-baseline gap-1.5 font-mono">
                    <span className="text-4xl font-black tracking-tight text-[#1c1917]">{currentEval.irMin}</span>
                    <span className="text-xs text-[#57534e] font-black">MΩ</span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#78716c] uppercase mt-4 tracking-wider">FORMULA: kV + 1</p>
                </div>

                {/* Surface Temperature */}
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee]">
                  <span className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase block">TEMPERATURE</span>
                  <div className="mt-2 flex items-baseline gap-1.5 font-mono">
                    <span className="text-4xl font-black tracking-tight text-[#1c1917]">{latest.temperature}</span>
                    <span className="text-xs text-[#57534e] font-black">°C</span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#78716c] uppercase mt-4 tracking-wider">DS18B20 SENSOR</p>
                </div>

              </div>

              {/* Chart Section */}
              <div className="border-2 border-[#e2d8cd] p-6 sm:p-8 bg-[#f8f5ee]">
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 mb-8 font-mono">
                  <div>
                    <h3 className="text-sm font-black tracking-[0.2em] text-[#1c1917] uppercase">DEGRADATION TIMELINE</h3>
                    <p className="text-xs text-[#44403c] font-bold mt-0.5">Insulation Resistance Normalized to 40°C against Safety Baseline</p>
                  </div>
                  <span className="text-xs font-bold tracking-widest text-[#44403c] uppercase">
                    LIMIT: {currentEval.irMin} MΩ
                  </span>
                </div>
                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={telemetryLogs}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#cbd5e1" vertical={false} />
                      <XAxis dataKey="formattedDate" stroke="#44403c" fontSize={11} fontStyle="monospace" fontWeight="bold" />
                      <YAxis stroke="#44403c" fontSize={11} fontStyle="monospace" domain={[0, 'auto']} fontWeight="bold" />
                      <Tooltip contentStyle={{ backgroundColor: '#fbf9f5', borderColor: '#cbd5e1', borderWidth: '2px', borderRadius: '0px', fontFamily: 'monospace', fontWeight: 'bold' }} />
                      <Line type="monotone" dataKey="corrected_ir" name="Normalized IR (MΩ)" stroke="#6d28d9" strokeWidth={3} dot={{ r: 4, fill: '#6d28d9' }} />
                      <Line type="monotone" dataKey="ir_min" name="Minimum Allowed (MΩ)" stroke="#dc2626" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Scheduled Test Trigger Form */}
              <div className="border-2 border-[#e2d8cd] p-6 sm:p-8 bg-[#f8f5ee] font-mono">
                <div className="mb-6">
                  <h3 className="text-sm font-black tracking-[0.2em] text-[#1c1917] uppercase">MANUAL TEST SEQUENCE</h3>
                  <p className="text-xs text-[#44403c] font-bold mt-0.5">Execute dual-factor safety checks and pulse measurement relay</p>
                </div>

                {testExecutionError && (
                  <div className="mb-6 p-3 border-2 border-rose-300 bg-rose-50 text-rose-900 text-xs font-bold">
                    {testExecutionError}
                  </div>
                )}

                <form onSubmit={handleExecuteAutomatedTest} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">RAW RESISTANCE (MΩ)</label>
                      <input 
                        type="number" step="0.01" required value={simRawIR} onChange={(e) => setSimRawIR(e.target.value)}
                        className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">TEMPERATURE (°C)</label>
                      <input 
                        type="number" step="0.1" required value={simTemp} onChange={(e) => setSimTemp(e.target.value)}
                        className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">NC AUXILIARY CONTACT</label>
                      <select 
                        value={simNcAux ? "safe" : "unsafe"} 
                        onChange={(e) => setSimNcAux(e.target.value === "safe")}
                        className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold cursor-pointer"
                      >
                        <option value="safe" className="bg-[#fbf9f5]">DISCONNECTED (SAFE)</option>
                        <option value="unsafe" className="bg-[#fbf9f5]">CLOSED (ENERGIZED)</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">ZMPT101B SENSOR</label>
                      <select 
                        value={simZeroVolt ? "safe" : "unsafe"} 
                        onChange={(e) => setSimZeroVolt(e.target.value === "safe")}
                        className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold cursor-pointer"
                      >
                        <option value="safe" className="bg-[#fbf9f5]">0.00 VAC (ZERO VOLTS)</option>
                        <option value="unsafe" className="bg-[#fbf9f5]">VOLTAGE PRESENT</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isExecutingTest}
                    className="py-3 px-6 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-bold tracking-[0.25em] uppercase transition disabled:opacity-50 active:bg-neutral-800 shadow-sm cursor-pointer"
                  >
                    {isExecutingTest ? "EXECUTING..." : "DISPATCH MEASUREMENT SEQUENCE"}
                  </button>
                </form>
              </div>

            </motion.div>
          )}

          {/* TAB 2: AUDIT LOGS */}
          {activeTab === 'telemetry' && (
            <motion.div key="telemetry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-6xl mx-auto font-mono">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 border-b-2 border-[#e2d8cd] pb-6">
                <div>
                  <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">ARCHIVE</span>
                  <h2 className="text-3xl font-extrabold text-[#1c1917] tracking-tight mt-1">Inspection Logs</h2>
                </div>
                <button 
                  onClick={() => exportTelemetryToCSV(telemetryLogs, activeMotor)}
                  className="px-4 py-2 border-2 border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-bold tracking-widest text-[#1c1917] uppercase transition cursor-pointer"
                >
                  EXPORT CSV
                </button>
              </div>

              <div className="border-2 border-[#e2d8cd] overflow-x-auto bg-[#f8f5ee]">
                <table className="w-full text-left text-xs font-bold">
                  <thead className="border-b-2 border-[#e2d8cd] bg-[#f3eee6] text-[#44403c] uppercase tracking-widest text-xs">
                    <tr>
                      <th className="py-4 px-6">Timestamp</th>
                      <th className="py-4 px-6">Direct IR</th>
                      <th className="py-4 px-6">Temp</th>
                      <th className="py-4 px-6">Normalized (40°C)</th>
                      <th className="py-4 px-6">Baseline</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6">Operator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-[#e2d8cd] text-[#1c1917]">
                    {telemetryLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#f3eee6] transition">
                        <td className="py-4 px-6 text-[#57534e]">{log.formattedDate}</td>
                        <td className="py-4 px-6">{log.raw_ir} MΩ</td>
                        <td className="py-4 px-6 text-[#1c1917]">{log.temperature} °C</td>
                        <td className="py-4 px-6 text-purple-900 font-black">{log.corrected_ir} MΩ</td>
                        <td className="py-4 px-6 text-[#57534e]">{log.ir_min || 1.48} MΩ</td>
                        <td className="py-4 px-6">
                          <span className={`text-xs uppercase tracking-widest font-black ${
                            log.motor_status === 'Normal' ? 'text-emerald-800' : 'text-rose-700'
                          }`}>
                            {log.motor_status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-[#57534e]">{log.user_name || 'System AMU'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* TAB 3: SAFETY INTERLOCKS */}
          {activeTab === 'safety' && (
            <motion.div key="safety" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-4xl mx-auto font-mono">
              <div className="border-b-2 border-[#e2d8cd] pb-6">
                <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">SAFETY PROTOCOL</span>
                <h2 className="text-3xl font-extrabold text-[#1c1917] tracking-tight mt-1">Dual-Factor Interlocks</h2>
                <p className="text-xs font-bold text-[#44403c] mt-1">Compliance with NFPA 70E and IEEE Std 43 zero-energy verification</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee] flex flex-col justify-between">
                  <div>
                    <span className="text-xs tracking-widest text-[#57534e] uppercase block font-bold">INTERLOCK 01</span>
                    <h3 className="text-sm text-[#1c1917] mt-2 uppercase font-black">NC AUXILIARY CONTACT</h3>
                    <p className="text-xs text-[#44403c] mt-2 leading-relaxed font-semibold">
                      Dry auxiliary contact monitors starter state to confirm complete detachment from line power.
                    </p>
                  </div>
                  <div className="mt-8 pt-4 border-t-2 border-[#e2d8cd] flex justify-between items-center text-xs">
                    <span className="text-[#57534e] uppercase font-bold">CONTACTOR</span>
                    <span className="text-emerald-800 font-black uppercase tracking-widest">DISCONNECTED</span>
                  </div>
                </div>

                <div className="border-2 border-[#e2d8cd] p-6 bg-[#f8f5ee] flex flex-col justify-between">
                  <div>
                    <span className="text-xs tracking-widest text-[#57534e] uppercase block font-bold">INTERLOCK 02</span>
                    <h3 className="text-sm text-[#1c1917] mt-2 uppercase font-black">ZMPT101B VOLTAGE SENSING</h3>
                    <p className="text-xs text-[#44403c] mt-2 leading-relaxed font-semibold">
                      Active terminal sensing guaranteeing 0.00 VAC residual potential prior to insulation test.
                    </p>
                  </div>
                  <div className="mt-8 pt-4 border-t-2 border-[#e2d8cd] flex justify-between items-center text-xs">
                    <span className="text-[#57534e] uppercase font-bold">TERMINAL VOLTAGE</span>
                    <span className="text-emerald-800 font-black uppercase tracking-widest">0.00 VAC RMS</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: SYSTEM SETTINGS */}
          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 max-w-4xl mx-auto font-mono">
              <div className="border-b-2 border-[#e2d8cd] pb-6">
                <span className="text-xs font-bold tracking-[0.25em] text-[#57534e] uppercase">SYSTEM CONFIGURATION</span>
                <h2 className="text-3xl font-extrabold text-[#1c1917] tracking-tight mt-1">Plant Fleet & Accounts</h2>
              </div>

              {/* Plant Motors */}
              <div className="border-2 border-[#e2d8cd] p-6 sm:p-8 bg-[#f8f5ee]">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm tracking-[0.2em] text-[#1c1917] uppercase font-black">MOTOR ASSET REGISTRY</h3>
                  {isAdmin && (
                    <button 
                      onClick={() => setShowAddMotorModal(true)}
                      className="py-2 px-3 border-2 border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-bold tracking-widest text-[#1c1917] uppercase transition cursor-pointer"
                    >
                      + ADD MOTOR
                    </button>
                  )}
                </div>

                <div className="divide-y-2 divide-[#e2d8cd] text-xs">
                  {motors.map((m) => (
                    <div key={m.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <p className="text-[#1c1917] font-black uppercase tracking-wider">{m.motor_name}</p>
                        <p className="text-[#57534e] text-xs font-bold mt-0.5">{m.location} / {m.rated_voltage} VAC</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-purple-900 bg-purple-100 px-2.5 py-1 border border-purple-300 uppercase font-black">
                          BASELINE: {(m.rated_voltage / 1000 + 1).toFixed(3)} MΩ
                        </span>

                        {isAdmin && (
                          <div className="flex items-center gap-1.5 ml-2">
                            <button
                              onClick={() => handleOpenEditModal(m)}
                              className="p-1.5 border border-[#cbd5e1] hover:bg-[#ede5d8] text-[#1c1917] transition cursor-pointer"
                              title="Edit Motor"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteMotor(m.id, m.motor_name)}
                              className="p-1.5 border border-rose-300 hover:bg-rose-50 text-rose-700 transition cursor-pointer"
                              title="Delete Motor"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin User Provisioning */}
              {isAdmin ? (
                <div className="border-2 border-[#e2d8cd] p-6 sm:p-8 bg-[#f8f5ee] space-y-6">
                  <div>
                    <h3 className="text-sm tracking-[0.2em] text-[#1c1917] uppercase font-black">PROVISION ACCOUNT (ADMIN)</h3>
                    <p className="text-xs text-[#44403c] font-bold mt-0.5">Self-registration disabled. Create technician profiles directly.</p>
                  </div>

                  {userCreatedMessage && (
                    <div className="p-3 border-2 border-emerald-300 bg-emerald-50 text-emerald-900 text-xs font-black">
                      {userCreatedMessage}
                    </div>
                  )}

                  <form onSubmit={handleProvisionUser} className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">FULL NAME</label>
                        <input 
                          type="text" required value={newFullname} onChange={(e) => setNewFullname(e.target.value)}
                          placeholder="Juan Dela Cruz"
                          className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">WORK EMAIL</label>
                        <input 
                          type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="technician@plant.com"
                          className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">ROLE PRIVILEGE</label>
                        <select 
                          value={newRole} onChange={(e) => setNewRole(e.target.value)}
                          className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold cursor-pointer"
                        >
                          <option value="Employee" className="bg-[#fbf9f5]">EMPLOYEE</option>
                          <option value="Admin" className="bg-[#fbf9f5]">ADMINISTRATOR</option>
                        </select>
                      </div>
                    </div>

                    <button type="submit" className="py-3 px-6 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-bold tracking-[0.25em] uppercase transition active:bg-neutral-800 shadow-sm cursor-pointer">
                      CREATE ACCOUNT
                    </button>
                  </form>

                  <div className="pt-6 border-t-2 border-[#e2d8cd]">
                    <h4 className="text-xs font-black tracking-widest text-[#44403c] uppercase mb-3">AUTHORIZED PERSONNEL</h4>
                    <div className="divide-y-2 divide-[#e2d8cd] text-xs">
                      {registeredUsers.length === 0 ? (
                        <p className="text-[#78716c] py-2 font-bold">No provisioned users recorded in database.</p>
                      ) : (
                        registeredUsers.map((u) => (
                          <div key={u.id} className="py-3 flex items-center justify-between">
                            <div>
                              <p className="text-[#1c1917] font-bold">{u.fullname || u.email}</p>
                              <p className="text-xs text-[#57534e] font-semibold">{u.email}</p>
                            </div>
                            <span className="text-xs text-purple-900 bg-purple-100 px-2.5 py-0.5 border border-purple-300 uppercase tracking-widest font-black">
                              {u.role}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 border-2 border-[#e2d8cd] bg-[#f8f5ee] text-xs font-bold text-[#57534e]">
                  Technician status. Account provisioning and fleet modifications restricted.
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Mobile Bottom Dock */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#fbf9f5] border-t-2 border-[#e2d8cd] px-6 py-3 flex items-center justify-between z-40">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`text-xs font-mono tracking-[0.2em] uppercase transition-colors font-bold ${
                isActive ? 'text-[#1c1917] border-b-2 border-purple-700 pb-0.5' : 'text-[#78716c]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Admin Add Motor Modal */}
      {showAddMotorModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 font-mono">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-[#fbf9f5] border-2 border-[#cbd5e1] p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-sm tracking-[0.2em] text-[#1c1917] uppercase font-black mb-1">REGISTER MOTOR ASSET</h3>
            <p className="text-xs text-[#44403c] font-bold mb-6">Add a three-phase motor to the active registry.</p>

            <form onSubmit={handleCreateMotor} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">IDENTIFIER</label>
                <input 
                  type="text" required value={newMotorName} onChange={(e) => setNewMotorName(e.target.value)}
                  placeholder="WATER PUMP 04"
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">LOCATION</label>
                <input 
                  type="text" required value={newMotorLocation} onChange={(e) => setNewMotorLocation(e.target.value)}
                  placeholder="BASEMENT SECTION B"
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">OPERATING VOLTAGE</label>
                <select
                  value={newMotorVoltage}
                  onChange={(e) => setNewMotorVoltage(Number(e.target.value))}
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold cursor-pointer"
                >
                  {IEEE_VOLTAGE_THRESHOLDS.map((t) => (
                    <option key={t.voltage} value={t.voltage} className="bg-[#fbf9f5]">
                      {t.voltage} VAC (BASELINE: {t.irMin} MΩ)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t-2 border-[#e2d8cd]">
                <button 
                  type="button" 
                  onClick={() => setShowAddMotorModal(false)}
                  className="py-2.5 px-4 text-xs font-bold tracking-widest text-[#57534e] uppercase hover:text-[#1c1917] transition cursor-pointer"
                >
                  CANCEL
                </button>
                <button 
                  type="submit"
                  className="py-2.5 px-5 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-bold tracking-widest uppercase transition active:bg-neutral-800 shadow-sm cursor-pointer"
                >
                  COMMIT
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Admin Edit Motor Modal */}
      {showEditMotorModal && editingMotor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 font-mono">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-[#fbf9f5] border-2 border-[#cbd5e1] p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-sm tracking-[0.2em] text-[#1c1917] uppercase font-black mb-1">EDIT MOTOR ASSET</h3>
            <p className="text-xs text-[#44403c] font-bold mb-6">Modify asset tag, location, or rated voltage.</p>

            <form onSubmit={handleSaveMotorEdit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">IDENTIFIER</label>
                <input 
                  type="text" 
                  required 
                  value={editingMotor.motor_name} 
                  onChange={(e) => setEditingMotor({ ...editingMotor, motor_name: e.target.value })}
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">LOCATION</label>
                <input 
                  type="text" 
                  required 
                  value={editingMotor.location} 
                  onChange={(e) => setEditingMotor({ ...editingMotor, location: e.target.value })}
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold tracking-[0.2em] text-[#44403c] uppercase block">OPERATING VOLTAGE</label>
                <select
                  value={editingMotor.rated_voltage}
                  onChange={(e) => setEditingMotor({ ...editingMotor, rated_voltage: Number(e.target.value) })}
                  className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2 text-xs text-[#1c1917] focus:outline-none rounded-none font-bold cursor-pointer"
                >
                  {IEEE_VOLTAGE_THRESHOLDS.map((t) => (
                    <option key={t.voltage} value={t.voltage} className="bg-[#fbf9f5]">
                      {t.voltage} VAC (BASELINE: {t.irMin} MΩ)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t-2 border-[#e2d8cd]">
                <button 
                  type="button" 
                  onClick={() => { setShowEditMotorModal(false); setEditingMotor(null); }}
                  className="py-2.5 px-4 text-xs font-bold tracking-widest text-[#57534e] uppercase hover:text-[#1c1917] transition cursor-pointer"
                >
                  CANCEL
                </button>
                <button 
                  type="submit"
                  className="py-2.5 px-5 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-bold tracking-widest uppercase transition active:bg-neutral-800 shadow-sm cursor-pointer"
                >
                  SAVE CHANGES
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}