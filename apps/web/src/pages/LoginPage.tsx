import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, FlaskConical, GraduationCap, Lock, LogIn, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authIssueMessage } from '@/lib/authMessages';
import { postLoginPath } from '@/lib/authNavigation';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useUIStore, type ThemeMode } from '@/stores/uiStore';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const status = useAuthStore((state) => state.status);
  const issue = useAuthStore((state) => state.issue);
  const { theme, setTheme } = useUIStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [formError, setFormError] = useState('');
  const authenticating = status === 'authenticating';

  if (status === 'authenticated' || status === 'logging_out') {
    return <Navigate to={postLoginPath(location.state)} replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (authenticating) return;

    setFormError('');
    const result = await login(email, password, remember);
    setPassword('');

    if (result.ok) {
      toast('Selamat datang di SmartLab PPLG', 'success');
      navigate(postLoginPath(location.state), { replace: true });
      return;
    }

    setFormError(authIssueMessage(result.issue));
  }

  const errorMessage = formError || authIssueMessage(issue);

  return (
    <div className="flex min-h-screen flex-col bg-base-900 lg:flex-row">
      <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-base-800 via-base-900 to-base-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute -left-20 top-20 h-72 w-72 rounded-full bg-brand-blue/30 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-brand-cyan/20 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan text-white shadow-elevated">
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
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-base-700 bg-base-800/50 p-4">
                <p className="text-2xl font-bold text-accent-content">{item.value}</p>
                <p className="mt-1 text-xs text-ink-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-ink-muted">
          <GraduationCap className="h-4 w-4" />
          <span>SMK Negeri 1 Purwokerto · Program Keahlian PPLG</span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-4 flex items-center justify-end gap-2">
            <label htmlFor="login-theme" className="text-xs text-ink-muted">Tema</label>
            <select
              id="login-theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeMode)}
              className="rounded-lg border border-base-700 bg-base-800 px-2 py-1.5 text-xs text-ink-secondary outline-none focus:ring-2 focus:ring-accent-content/60"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan text-white shadow-elevated">
              <FlaskConical className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-ink-primary">SMARTLAB PPLG</h1>
            <p className="text-xs text-ink-muted">Laboratory Management System</p>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-ink-primary">Masuk ke akun Anda</h2>
            <p className="mt-1 text-sm text-ink-muted">Gunakan akun SmartLab yang dikelola sekolah.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={authenticating}>
            {status === 'bootstrapping' && (
              <div className="rounded-lg border border-base-700 bg-base-800 px-3 py-2.5 text-sm text-ink-muted" role="status">
                Memeriksa sesi Anda...
              </div>
            )}
            {errorMessage && status !== 'bootstrapping' && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger" role="alert" aria-live="polite">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            {(status === 'error' || (status === 'context_error' && issue?.retryable)) && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void bootstrapSession()}>
                Periksa sesi lagi
              </Button>
            )}
            <Input
              label="Email"
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              icon={<Mail className="h-4 w-4" />}
              placeholder="nama@sekolah.sch.id"
              required
              autoComplete="email"
              disabled={authenticating || status === 'bootstrapping'}
            />
            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                icon={<Lock className="h-4 w-4" />}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                disabled={authenticating || status === 'bootstrapping'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={authenticating}
                className="mt-1 flex items-center gap-1 text-xs text-ink-muted hover:text-ink-secondary disabled:opacity-50"
              >
                {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {showPassword ? 'Sembunyikan' : 'Tampilkan'} password
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  disabled={authenticating}
                  className="h-4 w-4 rounded border-base-600 bg-base-800 text-accent-content focus:ring-accent-content"
                />
                Ingat saya
              </label>
              <button
                type="button"
                className="text-sm text-accent-content hover:underline"
                onClick={() => toast('Fitur lupa password belum tersedia.', 'info')}
              >
                Lupa password? (belum tersedia)
              </button>
            </div>

            <Button
              type="submit"
              size="lg"
              loading={authenticating}
              disabled={status === 'bootstrapping'}
              className="w-full"
              icon={<LogIn className="h-4 w-4" />}
            >
              Masuk
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-base-700" /></div>
              <div className="relative flex justify-center"><span className="bg-base-900 px-3 text-xs text-ink-muted">atau</span></div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => toast('Login Google belum tersedia.', 'info')}
            >
              Masuk dengan Google (belum tersedia)
            </Button>
          </form>

          <p className="mt-6 text-center text-[10px] text-ink-muted">SmartLab PPLG v1.0.0 · Frontend Prototype</p>
        </div>
      </div>
    </div>
  );
}
