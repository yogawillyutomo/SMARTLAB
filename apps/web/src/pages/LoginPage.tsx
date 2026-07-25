import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, Mail, Lock, Eye, EyeOff, LogIn, AlertCircle, GraduationCap } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useAppData } from '@/hooks/useAppData';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/toastStore';
import type { RoleName } from '@/types';

const DEMO_ACCOUNTS: { email: string; role: RoleName; label: string }[] = [
  { email: 'admin@smartlab.local', role: 'Super Admin', label: 'Super Admin' },
  { email: 'siti@smartlab.local', role: 'Admin Lab', label: 'Admin Lab' },
  { email: 'rudi@smartlab.local', role: 'Kepala Lab', label: 'Kepala Lab' },
  { email: 'teknisi@smartlab.local', role: 'Teknisi', label: 'Teknisi' },
  { email: 'guru@smartlab.local', role: 'Guru', label: 'Guru' },
  { email: 'pimpinan@smartlab.local', role: 'Pimpinan', label: 'Pimpinan' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loginAs } = useAuthStore();
  const { db } = useAppData();
  const [email, setEmail] = useState('admin@smartlab.local');
  const [password, setPassword] = useState('password');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      const result = login(email, password, db.users);
      setLoading(false);
      if (result.ok) {
        toast('Selamat datang di SmartLab PPLG', 'success');
        navigate('/dashboard');
      } else {
        setError(result.error ?? 'Login gagal');
      }
    }, 500);
  }

  function quickLogin(accEmail: string) {
    const user = db.users.find((u) => u.email === accEmail);
    if (!user) return;
    setEmail(accEmail);
    setPassword('password');
    setLoading(true);
    setTimeout(() => {
      loginAs(user);
      setLoading(false);
      toast(`Masuk sebagai ${user.role}`, 'success');
      navigate('/dashboard');
    }, 300);
  }

  return (
    <div className="flex min-h-screen flex-col bg-base-900 lg:flex-row">
      {/* Left brand panel */}
      <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-base-800 via-base-900 to-base-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute -left-20 top-20 h-72 w-72 rounded-full bg-accent-blue/30 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-96 w-96 rounded-full bg-accent-cyan/20 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue to-accent-cyan text-white shadow-elevated">
              <FlaskConical className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-bold text-ink-primary">SMARTLAB PPLG</p>
              <p className="text-xs text-ink-muted">Laboratory Management System</p>
            </div>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="max-w-md text-3xl font-bold leading-tight text-ink-primary">
            Kelola laboratorium sekolah Anda dengan lebih cerdas.
          </h1>
          <p className="max-w-md text-sm text-ink-secondary">
            Pantau komputer, jadwal praktikum, inventaris, hingga laporan kerusakan dalam satu sistem terpadu.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            {[
              { label: 'Monitoring PC Realtime', value: '108 PC' },
              { label: 'Laboratorium', value: '3 Lab' },
              { label: 'Tahun Ajaran', value: '2026/2027' },
              { label: 'Semester', value: 'Gasal' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-base-700 bg-base-800/50 p-4">
                <p className="text-2xl font-bold text-accent-blue">{s.value}</p>
                <p className="mt-1 text-xs text-ink-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-ink-muted">
          <GraduationCap className="h-4 w-4" />
          <span>SMK Negeri 1 Purwokerto · Program Keahlian PPLG</span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue to-accent-cyan text-white shadow-elevated">
              <FlaskConical className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-ink-primary">SMARTLAB PPLG</h1>
            <p className="text-xs text-ink-muted">Laboratory Management System</p>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-ink-primary">Masuk ke akun Anda</h2>
            <p className="mt-1 text-sm text-ink-muted">SMK Negeri 1 Purwokerto · PPLG</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Input
              label="Email"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail className="h-4 w-4" />}
              placeholder="nama@smartlab.local"
              required
              autoComplete="email"
            />
            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Lock className="h-4 w-4" />}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="mt-1 flex items-center gap-1 text-xs text-ink-muted hover:text-ink-secondary"
              >
                {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showPassword ? 'Sembunyikan' : 'Tampilkan'} password
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-base-600 bg-base-800 text-accent-blue focus:ring-accent-blue"
                />
                Ingat saya
              </label>
              <button type="button" className="text-sm text-accent-blue hover:underline" onClick={() => toast('Fitur lupa password akan tersedia di backend Laravel', 'info')}>
                Lupa password?
              </button>
            </div>

            <Button type="submit" size="lg" loading={loading} className="w-full" icon={<LogIn className="h-4 w-4" />}>
              Masuk
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-base-700" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-base-900 px-3 text-xs text-ink-muted">atau</span>
              </div>
            </div>

            <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => toast('Login Google memerlukan konfigurasi backend OAuth', 'info')}>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Masuk dengan Google
            </Button>
          </form>

          {/* Demo accounts */}
          <div className="mt-6 rounded-xl border border-base-700 bg-base-800/50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Akun Demo (klik untuk masuk)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  onClick={() => quickLogin(acc.email)}
                  className="flex flex-col items-start rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-left transition-colors hover:border-accent-blue/50 hover:bg-base-700/40"
                >
                  <span className="text-xs font-semibold text-ink-primary">{acc.label}</span>
                  <span className="text-[10px] text-ink-muted truncate w-full">{acc.email}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-ink-muted">Password untuk semua akun demo: <code className="rounded bg-base-700 px-1 py-0.5 text-ink-secondary">password</code></p>
          </div>

          <p className="mt-6 text-center text-[10px] text-ink-muted">SmartLab PPLG v1.0.0 · Frontend Prototype</p>
        </div>
      </div>
    </div>
  );
}
