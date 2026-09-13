import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowRight } from 'lucide-react';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      await login(email, password);
    } catch {
      setError('INVALID CREDENTIALS');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#fbf9f5] text-[#1c1917] p-6 sm:p-12 selection:bg-purple-700 selection:text-white">
      {/* Top Editorial Index */}
      <div className="flex items-center justify-between border-b-2 border-[#e2d8cd] pb-4 font-mono font-bold text-xs tracking-[0.25em] text-[#44403c] uppercase">
        <span>Y.U.T.A. SYSTEM</span>
        <span>AUTONOMOUS TELEMETRY</span>
      </div>

      {/* Main Form Block */}
      <div className="w-full max-w-sm mx-auto my-auto py-12">
        <div className="mb-10 text-center flex flex-col items-center">
          {/* Brand Logo */}
          <img 
            src="/yuta-logo.png" 
            alt="Y.U.T.A. Logo" 
            className="w-16 h-16 object-contain mb-4"
          />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1c1917]">Sign In</h1>
          <p className="text-xs font-mono font-bold tracking-[0.2em] text-[#57534e] uppercase mt-2">
            Insulation Resistance System
          </p>
        </div>

        {error && (
          <div className="mb-6 py-3 px-3 border border-rose-300 bg-rose-50 text-rose-900 text-xs font-mono font-bold tracking-widest text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-mono font-bold tracking-[0.2em] text-[#44403c] uppercase block">Account Identity</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="technician@plant.com"
              className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2.5 text-sm text-[#1c1917] placeholder-[#78716c] font-semibold focus:outline-none transition rounded-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono font-bold tracking-[0.2em] text-[#44403c] uppercase block">Security Passcode</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-transparent border-b-2 border-[#cbd5e1] focus:border-purple-700 py-2.5 text-sm text-[#1c1917] placeholder-[#78716c] font-semibold focus:outline-none transition rounded-none"
            />
          </div>

          <button
            type="submit"
            className="w-full mt-4 py-3.5 bg-[#1c1917] hover:bg-black text-[#fbf9f5] text-xs font-mono font-bold tracking-[0.25em] uppercase transition flex items-center justify-center gap-2 active:bg-neutral-800 shadow-sm cursor-pointer"
          >
            ENTER SYSTEM <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </form>

        {/* Demo Fast Logins */}
        <div className="mt-12 pt-6 border-t-2 border-[#e2d8cd]">
          <p className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#78716c] uppercase text-center mb-3">
            Demo Access / Test Purposes Only
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setEmail('admin@yuta.com'); setPassword('password123'); }}
              className="py-2.5 px-3 border border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-mono font-bold tracking-[0.2em] text-[#292524] uppercase transition cursor-pointer"
            >
              ADMIN
            </button>
            <button
              type="button"
              onClick={() => { setEmail('employee@yuta.com'); setPassword('password123'); }}
              className="py-2.5 px-3 border border-[#cbd5e1] bg-[#f3eee6] hover:bg-[#ede5d8] text-xs font-mono font-bold tracking-[0.2em] text-[#292524] uppercase transition cursor-pointer"
            >
              EMPLOYEE
            </button>
          </div>
        </div>
      </div>

      {/* Footer Colophon */}
      <div className="flex items-center justify-between border-t-2 border-[#e2d8cd] pt-4 text-[11px] font-mono font-bold text-[#57534e] uppercase tracking-widest">
        <span>COLLEGE OF INFORMATION & COMPUTING SCIENCES</span>
        <span>Capstone 2026</span>
      </div>
    </div>
  );
};