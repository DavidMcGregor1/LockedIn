import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
const API_BASE_URL = import.meta.env.DEV ? '' : configuredApiBaseUrl

const metricDefinitions = [
  {
    key: 'waterLiters',
    label: 'Water',
    goalLabel: 'Goal: 2 L',
    goalValue: 2,
    increment: 0.1,
    color: '#4f6fe8',
    unitLabel: 'L',
    displayValue: (value) => value.toFixed(1),
    formatValue: (value) => `${value.toFixed(1)} L`,
    progressText: (value, goalValue) => `${Math.round((value / goalValue) * 100)}%`,
  },
  {
    key: 'exerciseMinutes',
    label: 'Exercise',
    goalLabel: 'Goal: 45 min',
    goalValue: 45,
    increment: 5,
    color: '#3f9a50',
    unitLabel: 'min',
    displayValue: (value) => `${Math.round(value)}`,
    formatValue: (value) => `${Math.round(value)} min`,
    progressText: (value, goalValue) => `${Math.round((value / goalValue) * 100)}%`,
  },
  {
    key: 'sleepHours',
    label: 'Sleep',
    goalLabel: 'Goal: 8 hrs',
    goalValue: 8,
    increment: 0.1,
    color: '#8b5ce6',
    unitLabel: 'hrs',
    displayValue: (value) => value.toFixed(1),
    formatValue: (value) => `${value.toFixed(1)} hrs`,
    progressText: (value, goalValue) => `${Math.round((value / goalValue) * 100)}%`,
  },
  {
    key: 'steps',
    label: 'Steps',
    goalLabel: 'Goal: 10,000',
    goalValue: 10000,
    increment: 250,
    color: '#6d4ed6',
    unitLabel: '',
    displayValue: (value) => Math.round(value).toLocaleString(),
    formatValue: (value) => Math.round(value).toLocaleString(),
    progressText: (value, goalValue) => `${Math.round((value / goalValue) * 100)}%`,
  },
  {
    key: 'moneySpent',
    label: 'Money Spent',
    goalLabel: 'Goal: under £20',
    goalValue: 20,
    increment: 1,
    color: '#f06f36',
    unitLabel: '',
    displayValue: (value) => `£${value.toFixed(0)}`,
    formatValue: (value) => `£${value.toFixed(2)}`,
    progressText: (value, goalValue) => (value <= goalValue ? 'On track' : 'Over goal'),
  },
]

const metricDefinitionByKey = Object.fromEntries(
  metricDefinitions.map((definition) => [definition.key, definition]),
)
const defaultTodayForm = {
  waterLiters: 0,
  exerciseMinutes: 0,
  sleepHours: 0,
  steps: 0,
  moneySpent: 0,
}
const defaultGoalValues = Object.fromEntries(
  metricDefinitions.map((definition) => [definition.key, definition.goalValue]),
)

const exerciseOptions = [
  { id: 'gym', label: 'Gym', icon: '🏋️' },
  { id: 'run', label: 'Run', icon: '🏃' },
  { id: 'cycle', label: 'Cycle', icon: '🚴' },
  { id: 'swim', label: 'Swim', icon: '🏊' },
  { id: 'walk', label: 'Walk', icon: '🚶' },
  { id: 'football', label: 'Football', icon: '⚽' },
  { id: 'yoga', label: 'Yoga', icon: '🧘' },
  { id: 'hiit', label: 'HIIT', icon: '⚡' },
  { id: 'other', label: 'Other', icon: '⋯' },
]

async function requestJson(url, options) {
  const requestUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`
  const response = await fetch(requestUrl, options)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.status === 204 ? null : response.json()
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function getCompletionStorageKey(userId, dateIso) {
  return `lockedin-completed-${userId}-${dateIso}`
}

function normalizeGoalValues(goalValues) {
  const normalized = { ...defaultGoalValues }
  for (const definition of metricDefinitions) {
    const rawValue = Number(goalValues?.[definition.key])
    normalized[definition.key] = Number.isFinite(rawValue) && rawValue > 0
      ? rawValue
      : definition.goalValue
  }

  return normalized
}

function parseMetricInput(definition, inputValue) {
  const cleaned = String(inputValue ?? '').replace(/[^\d.]/g, '')
  if (!cleaned) {
    return 0
  }

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  if (definition.increment >= 1) {
    return Math.round(parsed)
  }

  return Math.round(parsed * 10) / 10
}

function App() {
  const location = useLocation()
  const [users, setUsers] = useState([])
  const [activeUserId, setActiveUserId] = useState(
    () => {
      const savedUserId = localStorage.getItem('lockedin-user-id') ?? ''
      return /^\d+$/.test(savedUserId) ? savedUserId : ''
    },
  )
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('lockedin-auth') === '1',
  )
  const [userGoals, setUserGoals] = useState(defaultGoalValues)
  const [hasUserGoals, setHasUserGoals] = useState(false)
  const [isGoalsLoading, setIsGoalsLoading] = useState(false)
  const [goalsLoadedUserId, setGoalsLoadedUserId] = useState('')
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false)
  const [isGoalsRequired, setIsGoalsRequired] = useState(false)
  const [isSavingGoals, setIsSavingGoals] = useState(false)
  const [goalsError, setGoalsError] = useState('')

  function clearAuthSession() {
    localStorage.removeItem('lockedin-auth')
    localStorage.removeItem('lockedin-user-id')
    setIsAuthenticated(false)
    setUsers([])
    setActiveUserId('')
    setUserGoals(defaultGoalValues)
    setHasUserGoals(false)
    setGoalsLoadedUserId('')
    setIsGoalsModalOpen(false)
    setIsGoalsRequired(false)
    setGoalsError('')
  }

  function syncUsers(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return false
    }

    setUsers(data)
    const savedUserId = localStorage.getItem('lockedin-user-id')
    const selectedUser =
      data.find((user) => user.id === savedUserId) ??
      data.find((user) => user.id === activeUserId) ??
      data[0]

    if (!selectedUser) {
      return false
    }

    setActiveUserId(selectedUser.id)
    localStorage.setItem('lockedin-user-id', selectedUser.id)
    return true
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setUsers([])
      setActiveUserId('')
      setUserGoals(defaultGoalValues)
      setHasUserGoals(false)
      setGoalsLoadedUserId('')
      setIsGoalsModalOpen(false)
      setIsGoalsRequired(false)
      setGoalsError('')
      return
    }

    let cancelled = false

    function refreshUsers(hardFail = false) {
      requestJson('/api/users')
        .then((data) => {
          if (cancelled) {
            return
          }

          const synced = syncUsers(data)
          if (!synced && hardFail) {
            clearAuthSession()
          }
        })
        .catch(() => {
          if (cancelled || !hardFail) {
            return
          }

          clearAuthSession()
        })
    }

    refreshUsers(true)

    const refreshIntervalId = setInterval(() => refreshUsers(false), 15000)
    const handleWindowFocus = () => refreshUsers(false)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      cancelled = true
      clearInterval(refreshIntervalId)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [activeUserId, isAuthenticated])

  const activeUser = useMemo(
    () => users.find((user) => user.id === activeUserId),
    [activeUserId, users],
  )

  useEffect(() => {
    if (!isAuthenticated || !activeUserId) {
      setUserGoals(defaultGoalValues)
      setHasUserGoals(false)
      setIsGoalsLoading(false)
      setGoalsLoadedUserId('')
      return
    }

    setIsGoalsLoading(true)
    setGoalsLoadedUserId('')
    requestJson(`/api/users/${activeUserId}/goals`)
      .then((data) => {
        if (!data) {
          setUserGoals(defaultGoalValues)
          setHasUserGoals(false)
          return
        }

        setUserGoals(normalizeGoalValues(data))
        setHasUserGoals(true)
      })
      .catch(() => {
        setUserGoals(defaultGoalValues)
        setHasUserGoals(false)
      })
      .finally(() => {
        setIsGoalsLoading(false)
        setGoalsLoadedUserId(activeUserId)
      })
  }, [activeUserId, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated ||
      !activeUserId ||
      isGoalsLoading ||
      hasUserGoals ||
      goalsLoadedUserId !== activeUserId ||
      location.pathname !== '/today') {
      return
    }

    setGoalsError('')
    setIsGoalsRequired(true)
    setIsGoalsModalOpen(true)
  }, [activeUserId, goalsLoadedUserId, hasUserGoals, isAuthenticated, isGoalsLoading, location.pathname])

  function markAuthenticated(user) {
    localStorage.setItem('lockedin-auth', '1')
    localStorage.setItem('lockedin-user-id', user.id)
    setActiveUserId(user.id)
    setIsAuthenticated(true)
  }

  async function saveGoals(goalValues) {
    if (!activeUserId) {
      return false
    }

    setIsSavingGoals(true)
    setGoalsError('')
    try {
      const payload = normalizeGoalValues(goalValues)
      const savedGoals = await requestJson(`/api/users/${activeUserId}/goals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setUserGoals(normalizeGoalValues(savedGoals ?? payload))
      setHasUserGoals(true)
      setGoalsLoadedUserId(activeUserId)
      setIsGoalsRequired(false)
      setIsGoalsModalOpen(false)
      return true
    } catch {
      setGoalsError('Could not save goals right now. Please try again.')
      return false
    } finally {
      setIsSavingGoals(false)
    }
  }

  return (
    <div className="mobile-app">
      <main className="content">
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? <Navigate to="/today" replace /> : <LoginPage onSuccess={markAuthenticated} />
            }
          />
          <Route
            path="/signup"
            element={
              isAuthenticated ? <Navigate to="/today" replace /> : <SignupPage onSuccess={markAuthenticated} />
            }
          />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route
            path="/today"
            element={
              isAuthenticated
                ? <TodayPage activeUserId={activeUserId} activeUser={activeUser} goals={userGoals} />
                : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/dashboard"
            element={
              isAuthenticated
                ? <DashboardPage activeUserId={activeUserId} activeUser={activeUser} />
                : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/compare"
            element={
              isAuthenticated ? <ComparePage users={users} activeUserId={activeUserId} /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/account"
            element={
              isAuthenticated
                ? (
                    <AccountPage
                      activeUser={activeUser}
                      goals={userGoals}
                      onSignOut={clearAuthSession}
                      onManageGoals={() => {
                        setGoalsError('')
                        setIsGoalsRequired(false)
                        setIsGoalsModalOpen(true)
                      }}
                    />
                  )
                : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? '/today' : '/login'} replace />} />
        </Routes>
      </main>

      {isAuthenticated && isGoalsModalOpen && (
        <GoalSettingsModal
          initialGoals={userGoals}
          isRequired={isGoalsRequired}
          isSaving={isSavingGoals}
          error={goalsError}
          onClose={() => {
            if (isGoalsRequired) {
              return
            }

            setIsGoalsModalOpen(false)
          }}
          onSave={saveGoals}
        />
      )}

      {isAuthenticated && (
        <nav className="bottom-nav">
          <NavLink to="/today">
            <span className="nav-icon"><BottomNavIcon type="today" /></span>
            <span>Today</span>
          </NavLink>
          <NavLink to="/dashboard">
            <span className="nav-icon"><BottomNavIcon type="dashboard" /></span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/compare">
            <span className="nav-icon"><BottomNavIcon type="compare" /></span>
            <span>Compare</span>
          </NavLink>
          <NavLink to="/account">
            <span className="nav-icon"><BottomNavIcon type="profile" /></span>
            <span>Profile</span>
          </NavLink>
        </nav>
      )}
    </div>
  )
}

function LoginPage({ onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const user = await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      onSuccess(user)
      navigate('/today', { replace: true })
    } catch {
      setError('Invalid username or password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page">
      <header className="auth-header">
        <h2>Welcome back</h2>
        <p>Log in to continue your Lock In streak.</p>
      </header>
      <form className="auth-card" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Username</span>
          <input
            type="text"
            required
            placeholder="your_username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="auth-error-text">{error}</p>}
        <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
          Log In
        </button>
      </form>
      <p className="auth-switch-text">
        Don&apos;t have an account? <Link to="/signup">Sign up</Link>
      </p>
      <p className="auth-switch-text legal-links">
        <Link to="/support">Support</Link> · <Link to="/privacy">Privacy</Link>
      </p>
    </section>
  )
}

function SignupPage({ onSuccess }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const user = await requestJson('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          displayName: name.trim(),
        }),
      })
      onSuccess(user)
      navigate('/today', { replace: true })
    } catch (errorToHandle) {
      setError(
        errorToHandle instanceof Error && errorToHandle.message.includes('Username must be between 1 and 50 characters')
          ? 'Username must be between 1 and 50 characters.'
          :
        errorToHandle instanceof Error && errorToHandle.message.includes('409')
          ? 'Username already taken.'
          : 'Could not create account.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page">
      <header className="auth-header">
        <h2>Create account</h2>
        <p>Start tracking your habits with Locked In.</p>
      </header>
      <form className="auth-card" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Name</span>
          <input
            type="text"
            required
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Username</span>
          <input
            type="text"
            required
            placeholder="your_username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            placeholder="Create a password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="auth-error-text">{error}</p>}
        <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
          Sign Up
        </button>
      </form>
      <p className="auth-switch-text">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
      <p className="auth-switch-text legal-links">
        <Link to="/support">Support</Link> · <Link to="/privacy">Privacy</Link>
      </p>
    </section>
  )
}

function SupportPage() {
  return (
    <section className="public-page page-card">
      <h2>Support</h2>
      <p>If you need help with Locked In, email <a href="mailto:support@lockedin.app">support@lockedin.app</a>.</p>
      <p>We aim to respond within 2 business days.</p>
      <p className="public-page-links">
        <Link to="/privacy">Privacy Policy</Link>
        <span>·</span>
        <Link to="/login">Back to login</Link>
      </p>
    </section>
  )
}

function PrivacyPage() {
  return (
    <section className="public-page page-card">
      <h2>Privacy Policy</h2>
      <p>Locked In stores account details, goals, room membership, and habit entries so the app can function.</p>
      <p>We do not sell your personal data. Data is only used to provide app features and support.</p>
      <p>To request data deletion or ask privacy questions, contact <a href="mailto:privacy@lockedin.app">privacy@lockedin.app</a>.</p>
      <p className="public-page-links">
        <Link to="/support">Support</Link>
        <span>·</span>
        <Link to="/login">Back to login</Link>
      </p>
    </section>
  )
}

function TodayPage({ activeUserId, activeUser, goals }) {
  const [form, setForm] = useState(defaultTodayForm)
  const [selectedExercises, setSelectedExercises] = useState([])
  const [isExerciseSheetOpen, setIsExerciseSheetOpen] = useState(false)
  const [draftExercises, setDraftExercises] = useState([])
  const [isDayCompleted, setIsDayCompleted] = useState(false)
  const [hasLoadedTodayState, setHasLoadedTodayState] = useState(false)

  const liveStorageKey = useMemo(
    () => (activeUserId ? `lockedin-live-${activeUserId}` : ''),
    [activeUserId],
  )

  function persistLiveDay(nextForm, nextSelectedExercises) {
    if (!activeUserId || !liveStorageKey) {
      return
    }

    localStorage.setItem(
      liveStorageKey,
      JSON.stringify({
        date: getTodayIsoDate(),
        form: nextForm,
        selectedExercises: nextSelectedExercises,
      }),
    )
  }

  function syncLiveDayToApi(nextForm) {
    if (!activeUserId) {
      return
    }

    const payload = {
      userId: activeUserId,
      date: getTodayIsoDate(),
      ...nextForm,
    }

    requestJson('/api/live-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Keep local save behavior even when API is unavailable.
    })
  }

  useEffect(() => {
    if (!activeUserId || !liveStorageKey) {
      setHasLoadedTodayState(false)
      return
    }

    setHasLoadedTodayState(false)
    const todayIso = getTodayIsoDate()
    const localDay = localStorage.getItem(liveStorageKey)
    if (localDay) {
      try {
        const parsed = JSON.parse(localDay)
        if (parsed.date === todayIso) {
          if (parsed.form) {
            setForm({ ...defaultTodayForm, ...parsed.form })
          }
          setSelectedExercises(parsed.selectedExercises ?? [])
          setHasLoadedTodayState(true)
          return
        }
      } catch {
        // Ignore invalid local cache and fall back to API/default values.
      }
    }

    requestJson(`/api/today/${activeUserId}`)
      .then((entry) => {
        const nextForm = entry
          ? {
              waterLiters: entry.waterLiters,
              exerciseMinutes: entry.exerciseMinutes,
              sleepHours: entry.sleepHours,
              steps: entry.steps,
              moneySpent: entry.moneySpent,
            }
          : defaultTodayForm

        setForm(nextForm)
        setSelectedExercises([])
        localStorage.setItem(
          liveStorageKey,
          JSON.stringify({
            date: todayIso,
            form: nextForm,
            selectedExercises: [],
          }),
        )
        setHasLoadedTodayState(true)
      })
      .catch(() => {
        setForm(defaultTodayForm)
        setSelectedExercises([])
        localStorage.setItem(
          liveStorageKey,
          JSON.stringify({
            date: todayIso,
            form: defaultTodayForm,
            selectedExercises: [],
          }),
        )
        setHasLoadedTodayState(true)
      })
  }, [activeUserId, liveStorageKey])

  useEffect(() => {
    if (!activeUserId || !liveStorageKey || !hasLoadedTodayState) {
      return
    }

    localStorage.setItem(
      liveStorageKey,
      JSON.stringify({
        date: getTodayIsoDate(),
        form,
        selectedExercises,
      }),
    )
  }, [activeUserId, form, hasLoadedTodayState, selectedExercises, liveStorageKey])

  useEffect(() => {
    if (!activeUserId || !liveStorageKey) {
      return
    }

    let timerId

    const scheduleNextReset = () => {
      const now = new Date()
      const nextMidnight = new Date(now)
      nextMidnight.setHours(24, 0, 0, 0)
      const delay = Math.max(1000, nextMidnight.getTime() - now.getTime())

      timerId = setTimeout(() => {
        setForm(defaultTodayForm)
        setSelectedExercises([])
        setDraftExercises([])
        setIsExerciseSheetOpen(false)
        setIsDayCompleted(false)
        localStorage.setItem(
          liveStorageKey,
          JSON.stringify({
            date: getTodayIsoDate(),
            form: defaultTodayForm,
            selectedExercises: [],
          }),
        )
        scheduleNextReset()
      }, delay)
    }

    scheduleNextReset()

    return () => {
      if (timerId) {
        clearTimeout(timerId)
      }
    }
  }, [activeUserId, liveStorageKey])

  async function completeDay() {
    if (!activeUserId) {
      return
    }

    const todayIso = getTodayIsoDate()
    const payload = {
      userId: activeUserId,
      date: todayIso,
      ...form,
    }

    try {
      await requestJson('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      // Keep local save behavior even when API is unavailable.
    }

    localStorage.setItem(
      getCompletionStorageKey(activeUserId, todayIso),
      JSON.stringify({
        date: todayIso,
        form,
        selectedExercises,
        completedAt: new Date().toISOString(),
      }),
    )

    setIsDayCompleted(true)
  }

  useEffect(() => {
    if (!activeUserId) {
      return
    }

    const todayIso = getTodayIsoDate()
    const completed = localStorage.getItem(getCompletionStorageKey(activeUserId, todayIso))
    if (!completed) {
      setIsDayCompleted(false)
      return
    }

    try {
      const parsed = JSON.parse(completed)
      if (parsed.form) {
        setForm({ ...defaultTodayForm, ...parsed.form })
      }
      setSelectedExercises(parsed.selectedExercises ?? [])
      setIsDayCompleted(true)
    } catch {
      // Ignore corrupted completion cache.
      setIsDayCompleted(false)
    }
  }, [activeUserId])

  useEffect(() => {
    if (!activeUserId) {
      return
    }

    const todayIso = getTodayIsoDate()
    const completionKey = getCompletionStorageKey(activeUserId, todayIso)
    if (!localStorage.getItem(completionKey)) {
      return
    }

    localStorage.setItem(
      completionKey,
      JSON.stringify({
        date: todayIso,
        form,
        selectedExercises,
        completedAt: new Date().toISOString(),
      }),
    )
  }, [activeUserId, form, selectedExercises])

  useEffect(() => {
    if (!activeUserId || !liveStorageKey) {
      return
    }

    const localDay = localStorage.getItem(liveStorageKey)
    if (!localDay) {
      return
    }

    try {
      const parsed = JSON.parse(localDay)
      if (parsed.date !== getTodayIsoDate()) {
        setForm(defaultTodayForm)
        setSelectedExercises([])
      }
    } catch {
      setForm(defaultTodayForm)
      setSelectedExercises([])
    }
  }, [activeUserId, liveStorageKey])

  const completion = useMemo(() => {
    const completed = metricDefinitions.filter((definition) =>
      isComplete(definition, form[definition.key], goals?.[definition.key]),
    ).length
    return {
      completed,
      total: metricDefinitions.length,
      percent: Math.round((completed / metricDefinitions.length) * 100),
    }
  }, [form, goals])

  const dateText = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(new Date()),
    [],
  )

  function updateMetric(definition, nextValue) {
    setForm((current) => ({
      ...current,
      [definition.key]: parseMetricInput(definition, nextValue),
    }))
    const parsedValue = parseMetricInput(definition, nextValue)
    persistLiveDay(
      {
        ...form,
        [definition.key]: parsedValue,
      },
      selectedExercises,
    )
    syncLiveDayToApi({
      ...form,
      [definition.key]: parsedValue,
    })
  }

  function saveCurrentDayProgress() {
    persistLiveDay(form, selectedExercises)
    syncLiveDayToApi(form)
  }

  function openExerciseSheet() {
    setDraftExercises(selectedExercises)
    setIsExerciseSheetOpen(true)
  }

  function toggleDraftExercise(id) {
    setDraftExercises((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id)
      }

      if (current.length >= 3) {
        return current
      }

      return [...current, id]
    })
  }

  function saveExerciseSelection() {
    setSelectedExercises(draftExercises)
    setIsExerciseSheetOpen(false)
    persistLiveDay(form, draftExercises)
    syncLiveDayToApi(form)
  }

  if (!activeUser) {
    return <section className="page-card">Loading profile...</section>
  }

  return (
    <section className={`today-page ${isDayCompleted ? 'is-completed' : ''}`}>
      <header className="today-header">
        <div className="top-icons">
          <div className="brand">
            <h1>Locked In</h1>
          </div>
        </div>
        <div className="today-title-row">
          <div>
            <h2>TODAY</h2>
            <p>{dateText}</p>
          </div>
        </div>
      </header>

      {isDayCompleted ? (
        <div className="today-completed-state">
          <section className="day-completed-card">
            <div className="day-completed-badge">✓</div>
            <h3>{`Day Completed: ${completion.completed}/${completion.total} goals completed.`}</h3>
            <p>Your next day will begin at 00:00.</p>
            <button
              type="button"
              className="reopen-day-btn"
              onClick={() => {
                localStorage.removeItem(getCompletionStorageKey(activeUserId, getTodayIsoDate()))
                setIsDayCompleted(false)
                setIsExerciseSheetOpen(false)
                setDraftExercises(selectedExercises)
                persistLiveDay(form, selectedExercises)
              }}
            >
              Re-open day
            </button>
          </section>
        </div>
      ) : (
        <>
          <div className="daily-progress-card">
            <div className="daily-progress-row">
              <h3>Daily Progress</h3>
              <span className="progress-fraction">
                {completion.completed} / {completion.total}
              </span>
              <span className="progress-percent">{completion.percent}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${completion.percent}%` }} />
            </div>
          </div>

          <div className="habit-list">
            {metricDefinitions.map((definition) => {
              const value = form[definition.key]
              const goalValue = Number(goals?.[definition.key] ?? definition.goalValue)
              const progressWidth = getMetricProgress(definition, value, goalValue)
              const isExerciseCard = definition.key === 'exerciseMinutes'
              const selectedExerciseLabels = selectedExercises
                .map((id) => exerciseOptions.find((option) => option.id === id)?.label)
                .filter(Boolean)
              const exerciseSelectionText = selectedExerciseLabels.join(' · ')

              return (
                <article
                  className={`habit-row-card ${isExerciseCard ? 'exercise-card' : ''}`}
                  key={definition.key}
                  style={{ '--habit-color': definition.color }}
                >
                  <div className="habit-row-top">
                    <div className="habit-row-main">
                      <div className="habit-icon" style={{ backgroundColor: `${definition.color}16`, color: definition.color }}>
                        <HabitIcon metricKey={definition.key} />
                      </div>
                      <div>
                        <h4>{definition.label.toUpperCase()}</h4>
                        <p className="goal-text">{formatGoalText(definition, goalValue)}</p>
                      </div>
                    </div>
                    <div className="habit-row-right">
                      {isExerciseCard ? (
                        <div className="exercise-controls">
                          <label className="habit-input-field exercise-time-field">
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              value={value}
                              onChange={(event) => updateMetric(definition, event.target.value)}
                              onBlur={saveCurrentDayProgress}
                            />
                            <span className="habit-unit">min</span>
                          </label>
                          <button type="button" className="exercise-selection-pill" onClick={openExerciseSheet}>
                            {exerciseSelectionText || 'Select'}
                          </button>
                        </div>
                      ) : (
                        <label className="habit-input-field">
                          {definition.key === 'moneySpent' && <span className="money-prefix">£</span>}
                          <input
                            type="text"
                            inputMode={definition.increment >= 1 ? 'numeric' : 'decimal'}
                            autoComplete="off"
                            value={value}
                            onChange={(event) => updateMetric(definition, event.target.value)}
                            onBlur={saveCurrentDayProgress}
                          />
                          {definition.unitLabel && <span className="habit-unit">{definition.unitLabel}</span>}
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="habit-progress-track">
                    <div
                      className="habit-progress-fill"
                      style={{ width: `${progressWidth}%`, backgroundColor: definition.color }}
                    />
                  </div>
                </article>
              )
            })}
          </div>

          <button type="button" className="complete-day-btn" onClick={completeDay}>
            COMPLETE DAY
          </button>
        </>
      )}

      {isExerciseSheetOpen && (
        <>
          <button
            type="button"
            className="sheet-backdrop"
            aria-label="Close exercise selection"
            onClick={() => setIsExerciseSheetOpen(false)}
          />
          <section className="exercise-sheet" role="dialog" aria-modal="true" aria-label="Select Exercises">
            <h3>Select Exercises</h3>
            <div className="exercise-option-grid">
              {exerciseOptions.map((option) => {
                const selected = draftExercises.includes(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`exercise-option ${selected ? 'selected' : ''}`}
                    onClick={() => toggleDraftExercise(option.id)}
                    disabled={!selected && draftExercises.length >= 3}
                  >
                    <span className="exercise-option-icon">{option.icon}</span>
                    <span>{option.label}</span>
                    {selected && <span className="exercise-option-check">✓</span>}
                  </button>
                )
              })}
            </div>
            <button type="button" className="exercise-sheet-done" onClick={saveExerciseSelection}>
              Done
            </button>
          </section>
        </>
      )}

    </section>
  )
}

function DashboardPage({ activeUserId, activeUser }) {
  const [dashboard, setDashboard] = useState(null)

  useEffect(() => {
    if (!activeUserId) {
      return
    }

    requestJson(`/api/dashboard/${activeUserId}`)
      .then((data) => setDashboard(data))
      .catch(() => setDashboard(null))
  }, [activeUserId])

  const summary = dashboard?.summary ?? {
    daysCompleted: 0,
    averageScore: null,
    isScoreCalibrated: false,
    calibrationDaysRequired: 7,
    calibrationDaysCompleted: 0,
    bestStreak: activeUser?.streakDays ?? 0,
  }
  const streakDays = activeUser?.streakDays ?? 0
  const streakDots = Array.from({ length: 8 }, (_, index) => index < Math.min(streakDays, 7))
  const bestRecords = dashboard?.bestRecords ?? []
  const dateText = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date())

  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h2>Dashboard</h2>
          <p>Your progress at a glance</p>
        </div>
        <div className="dashboard-date-pill">{dateText}</div>
      </header>

      <article className="dashboard-streak-card">
        <p className="dashboard-section-eyebrow">LOCK-IN DAY STREAK</p>
        <div className="dashboard-streak-main">
          <div className="dashboard-streak-value">
            <strong>{streakDays}</strong>
            <span>days</span>
          </div>
          <div className="dashboard-streak-dots" aria-hidden="true">
            {streakDots.map((isFilled, index) => (
              <span
                key={`streak-dot-${index}`}
                className={`streak-dot ${isFilled ? 'filled' : ''}`}
              />
            ))}
          </div>
        </div>
        <p className="dashboard-streak-subtext">Your current streak</p>
      </article>

      <section className="dashboard-summary-card">
        <article className="dashboard-summary-item">
          <div className="dashboard-summary-icon days">
            <DashboardSummaryIcon type="daysCompleted" />
          </div>
          <strong>{summary.daysCompleted}</strong>
          <span>Days completed</span>
        </article>
        <article className="dashboard-summary-item">
          <div className="dashboard-summary-icon score">
            <DashboardSummaryIcon type="averageScore" />
          </div>
          <strong>{summary.averageScore ?? '--'}</strong>
          <span>
            {summary.isScoreCalibrated
              ? 'Avg. score'
              : summary.averageScore === null
                ? 'Start tracking to calibrate'
                : `Provisional ${summary.calibrationDaysCompleted}/${summary.calibrationDaysRequired}`}
          </span>
        </article>
        <article className="dashboard-summary-item">
          <div className="dashboard-summary-icon streak">
            <DashboardSummaryIcon type="bestStreak" />
          </div>
          <strong>{summary.bestStreak}</strong>
          <span>Best streak</span>
        </article>
      </section>

      <section className="dashboard-records-card">
        <div className="dashboard-records-head">
          <h3>Best Day Records</h3>
          <span>All time</span>
        </div>
        <div className="dashboard-records-list">
          {metricDefinitions.map((definition) => {
            const record = bestRecords.find((item) => item.metric === definition.key)

            return (
              <article className="dashboard-record-row" key={definition.key}>
                <div className="dashboard-record-main">
                  <div className="dashboard-record-icon" style={{ color: definition.color }}>
                    <HabitIcon metricKey={definition.key} />
                  </div>
                  <div>
                    <p className="dashboard-record-label">{definition.label}</p>
                    <p className="dashboard-record-sub">
                      {definition.key === 'moneySpent' ? 'Best (lowest)' : 'Best'}
                    </p>
                  </div>
                </div>
                <div className="dashboard-record-value">
                  <strong style={{ color: definition.color }}>
                    {record ? definition.formatValue(Number(record.value ?? 0)) : definition.formatValue(0)}
                  </strong>
                  <span>{record ? formatDisplayDate(record.date) : '-'}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </section>
  )
}

function formatDisplayDate(dateString) {
  if (!dateString) {
    return '-'
  }

  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) {
    return '-'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function ComparePage({ users, activeUserId }) {
  const [range, setRange] = useState('weekly')
  const [compareByMetric, setCompareByMetric] = useState({})
  const [userGoalsById, setUserGoalsById] = useState({})
  const [userScoreById, setUserScoreById] = useState({})
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false)
  const rangeMenuRef = useRef(null)

  useEffect(() => {
    if (!activeUserId) {
      setCompareByMetric({})
      return
    }

    let cancelled = false
    const metricKeys = metricDefinitions.map((definition) => definition.key)

    Promise.all(
      metricKeys.map((metricKey) =>
        requestJson(`/api/compare?metric=${metricKey}&range=${range}&userId=${activeUserId}`)
          .then((data) => [metricKey, data.data ?? []])
          .catch(() => [metricKey, []]),
      ),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      setCompareByMetric(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [activeUserId, range])

  useEffect(() => {
    function handleClickOutside(event) {
      if (rangeMenuRef.current && !rangeMenuRef.current.contains(event.target)) {
        setIsRangeMenuOpen(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsRangeMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const selectedMetricKeys = metricDefinitions.map((definition) => definition.key)
  const periodCount = range === 'today' ? 1 : range === 'weekly' ? 7 : 6
  const periodLabel = range === 'today' ? 'day' : range === 'weekly' ? 'days' : 'periods'
  const referenceRows = compareByMetric[selectedMetricKeys[0]] ?? []
  const periods = referenceRows.map((row) => row.period)
  const palette = ['#62e47f', '#3d7cff', '#a65bff', '#f09a47', '#27b2a2']
  const visibleUserNames = new Set(
    referenceRows.flatMap((row) => Object.keys(row).filter((key) => key !== 'period')),
  )
  const visibleUsers = users.filter((user) => visibleUserNames.has(user.name))
  const usersByName = visibleUsers.map((user) => ({
    ...user,
    color: palette[visibleUsers.indexOf(user) % palette.length],
  }))

  useEffect(() => {
    if (visibleUsers.length === 0) {
      setUserGoalsById({})
      return
    }

    let cancelled = false
    Promise.all(
      visibleUsers.map((user) =>
        requestJson(`/api/users/${user.id}/goals`)
          .then((goals) => [user.id, normalizeGoalValues(goals ?? defaultGoalValues)])
          .catch(() => [user.id, { ...defaultGoalValues }]),
      ),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      setUserGoalsById(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [visibleUsers])

  useEffect(() => {
    if (visibleUsers.length === 0) {
      setUserScoreById({})
      return
    }

    let cancelled = false
    Promise.all(
      visibleUsers.map((user) =>
        requestJson(`/api/dashboard/${user.id}`)
          .then((data) => {
            const summary = data?.summary ?? {}
            return [
              user.id,
              {
                averageScore: summary.averageScore === null || summary.averageScore === undefined
                  ? null
                  : Number(summary.averageScore),
                isScoreCalibrated: Boolean(summary.isScoreCalibrated),
                calibrationDaysCompleted: Number(summary.calibrationDaysCompleted ?? 0),
                calibrationDaysRequired: Number(summary.calibrationDaysRequired ?? 7),
              },
            ]
          })
          .catch(() => [
            user.id,
            {
              averageScore: null,
              isScoreCalibrated: false,
              calibrationDaysCompleted: 0,
              calibrationDaysRequired: 7,
            },
          ]),
      ),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      setUserScoreById(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [visibleUsers])

  const rankedUsers = usersByName
    .map((user) => {
      const scoreInfo = userScoreById[user.id] ?? {
        averageScore: null,
        isScoreCalibrated: false,
        calibrationDaysCompleted: 0,
        calibrationDaysRequired: 7,
      }
      const activePeriodScores = periods
        .map((period) => {
          const metricValues = selectedMetricKeys.map((metricKey) => {
            const metricRows = compareByMetric[metricKey] ?? []
            const row = metricRows.find((item) => item.period === period)
            return Number(row?.[user.name] ?? 0)
          })
          const hasAnyTrackedValue = metricValues.some((value) => value > 0)
          if (!hasAnyTrackedValue) {
            return null
          }

          const periodScores = metricValues.map((value, index) => {
            const metricKey = selectedMetricKeys[index]
            const definition = metricDefinitionByKey[metricKey]
            const goalValue = Number(userGoalsById?.[user.id]?.[definition.key] ?? definition.goalValue)
            return getMetricProgress(definition, value, goalValue)
          })
          return Math.round(average(periodScores))
        })
        .filter((score) => score !== null)
      const fallbackScore = activePeriodScores.length > 0
        ? Math.round(average(activePeriodScores))
        : null
      const averageScore = scoreInfo.averageScore ?? fallbackScore

      return {
        ...user,
        averageScore,
        isScoreCalibrated: scoreInfo.isScoreCalibrated,
        calibrationDaysCompleted: Math.max(scoreInfo.calibrationDaysCompleted, activePeriodScores.length),
        calibrationDaysRequired: scoreInfo.calibrationDaysRequired,
      }
    })
    .sort((left, right) => (right.averageScore ?? -1) - (left.averageScore ?? -1))

  const topUsers = rankedUsers.slice(0, 2)

  function getMetricUserStats(definition, user) {
    const rows = compareByMetric[definition.key] ?? []
    const values = rows.map((row) => Number(row?.[user.name] ?? 0))
    const total = values.reduce((sum, value) => sum + value, 0)
    const goalValue = Number(userGoalsById?.[user.id]?.[definition.key] ?? definition.goalValue)
    const completionCount = range === 'today'
      ? (isComplete(definition, total, goalValue) ? 1 : 0)
      : values.filter((value) => isComplete(definition, value, goalValue)).length
    const completionRate = range === 'today'
      ? getMetricProgress(definition, total, goalValue)
      : periodCount === 0
        ? 0
        : Math.round((completionCount / periodCount) * 100)
    const bestValue = definition.key === 'moneySpent' && values.length > 0 ? Math.min(...values) : null

    return {
      total,
      goalValue,
      completionCount,
      completionRate,
      bestValue,
    }
  }

  return (
    <section className="compare-page">
      <header className="compare-header">
        <div>
          <h2>Compare</h2>
          <p>See how you and your friends are locking in.</p>
        </div>
        <div className="compare-info-icon">i</div>
      </header>

      <section className="compare-rank-card">
        <div className="compare-rank-grid">
          {topUsers.map((user, index) => (
            <article
              key={user.id}
              className="compare-rank-item"
              style={{
                '--compare-color': user.color,
              }}
            >
              <p className="compare-rank-badge">{`#${index + 1}`}</p>
              <div className="compare-rank-avatar" style={{ borderColor: user.color }}>
                {user.name[0]}
              </div>
              <h3>{user.name}</h3>
              <strong>{user.averageScore ?? '--'}</strong>
              <p className="compare-rank-label">Avg. Lock In Score</p>
              <div className="compare-rank-progress-track">
                <div
                  className="compare-rank-progress-fill"
                  style={{ width: `${Math.min(100, user.averageScore ?? 0)}%` }}
                />
              </div>
              <p className="compare-rank-sub">
                {user.isScoreCalibrated
                  ? 'Calibrated from your last 7 tracked days'
                  : user.averageScore === null
                    ? 'Start tracking to begin calibration'
                    : `Provisional ${user.calibrationDaysCompleted}/${user.calibrationDaysRequired} days`}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="compare-weekly-card">
        <header className="compare-weekly-head">
          <h3>{range === 'today' ? 'Today Overview' : 'Weekly Overview'}</h3>
          <div className="compare-weekly-controls">
            <span>{periodCount} {periodLabel}</span>
            <div className="compare-range-select" ref={rangeMenuRef}>
              <button
                type="button"
                className="compare-range-trigger"
                onClick={() => setIsRangeMenuOpen((current) => !current)}
                aria-expanded={isRangeMenuOpen}
                aria-haspopup="menu"
              >
                {range === 'today' ? 'Today' : 'Weekly'}
              </button>
              {isRangeMenuOpen && (
                <div className="compare-range-menu" role="menu">
                  <button
                    type="button"
                    className={`compare-range-menu-item ${range === 'today' ? 'active' : ''}`}
                    onClick={() => {
                      setRange('today')
                      setIsRangeMenuOpen(false)
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={`compare-range-menu-item ${range === 'weekly' ? 'active' : ''}`}
                    onClick={() => {
                      setRange('weekly')
                      setIsRangeMenuOpen(false)
                    }}
                  >
                    Weekly
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="compare-users-row">
          {topUsers.map((user) => (
            <div key={`legend-${user.id}`} className="compare-user-chip">
              <span style={{ backgroundColor: `${user.color}35`, color: user.color }}>
                {user.name[0]}
              </span>
              <strong>{user.name}</strong>
            </div>
          ))}
        </div>
        <div className="compare-metric-list">
          {metricDefinitions.map((definition) => (
            <article key={`metric-row-${definition.key}`} className="compare-metric-card">
              <div className="compare-metric-main">
                <div className="compare-metric-icon" style={{ color: definition.color }}>
                  <HabitIcon metricKey={definition.key} />
                </div>
                <h4>{definition.label}</h4>
              </div>
              <div className="compare-metric-user-values">
                {topUsers.map((user) => {
                  const stats = getMetricUserStats(definition, user)
                  return (
                    <div key={`${definition.key}-${user.id}`} className="compare-metric-user-col">
                      <strong style={{ color: user.color }}>
                        {formatCompareTotal(definition, stats.total)}
                      </strong>
                      <span>
                        {range === 'today'
                          ? formatTodayGoalProgress(definition, stats.total, stats.goalValue)
                          : definition.key === 'moneySpent' && stats.bestValue !== null
                          ? `Best: ${formatMoney(stats.bestValue)}`
                          : `${stats.completionCount} of ${periodCount} ${periodLabel}`}
                      </span>
                      <div className="compare-metric-progress-track">
                        <div
                          className="compare-metric-progress-fill"
                          style={{
                            width: `${stats.completionRate}%`,
                            backgroundColor: user.color,
                          }}
                        />
                      </div>
                      <p>{`${stats.completionRate}%`}</p>
                    </div>
                  )
                })}
              </div>
              <div className="compare-metric-chevron">›</div>
            </article>
          ))}
          {topUsers.length === 0 && (
            <section className="page-card">
              <p>No users to compare yet.</p>
            </section>
          )}
        </div>
      </section>

    </section>
  )
}

function average(values) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getMetricScore(definition, value) {
  if (definition.key === 'moneySpent') {
    if (value <= 0) {
      return 100
    }

    return Math.max(0, Math.min(100, Math.round((definition.goalValue / value) * 100)))
  }

  return Math.max(0, Math.min(100, Math.round((value / definition.goalValue) * 100)))
}

function formatCompareTotal(definition, total) {
  if (definition.key === 'waterLiters') {
    return `${total.toFixed(1)} L`
  }

  if (definition.key === 'exerciseMinutes') {
    return `${Math.round(total)} min`
  }

  if (definition.key === 'sleepHours') {
    return `${total.toFixed(1)} hrs`
  }

  if (definition.key === 'steps') {
    return Math.round(total).toLocaleString()
  }

  return formatMoney(total)
}

function formatTodayGoalProgress(definition, total, goalValue) {
  if (definition.key === 'moneySpent') {
    if (total <= goalValue) {
      return `${formatMoney(goalValue - total)} left`
    }

    return `${formatMoney(total - goalValue)} over`
  }

  if (definition.key === 'waterLiters') {
    return `${total.toFixed(1)}/${goalValue.toFixed(1)} L`
  }

  if (definition.key === 'exerciseMinutes') {
    return `${Math.round(total)}/${Math.round(goalValue)} min`
  }

  if (definition.key === 'sleepHours') {
    return `${total.toFixed(1)}/${goalValue.toFixed(1)} hrs`
  }

  if (definition.key === 'steps') {
    return `${Math.round(total).toLocaleString()}/${Math.round(goalValue).toLocaleString()}`
  }
  return `${formatMoney(total)}/${formatMoney(goalValue)}`
}

function formatGoalText(definition, goalValue) {
  if (definition.key === 'waterLiters') {
    return `Goal: ${goalValue.toFixed(1)} L`
  }

  if (definition.key === 'exerciseMinutes') {
    return `Goal: ${Math.round(goalValue)} min`
  }

  if (definition.key === 'sleepHours') {
    return `Goal: ${goalValue.toFixed(1)} hrs`
  }

  if (definition.key === 'steps') {
    return `Goal: ${Math.round(goalValue).toLocaleString()}`
  }

  return `Goal: under £${Math.round(goalValue)}`
}

function formatMoney(value) {
  return `£${Math.round(value)}`
}

function GoalSettingsModal({ initialGoals, isRequired, isSaving, error, onClose, onSave }) {
  const [goalsForm, setGoalsForm] = useState(() => normalizeGoalValues(initialGoals))

  useEffect(() => {
    setGoalsForm(normalizeGoalValues(initialGoals))
  }, [initialGoals])

  function updateGoal(definition, nextValue) {
    setGoalsForm((current) => ({
      ...current,
      [definition.key]: parseMetricInput(definition, nextValue),
    }))
  }

  async function submitGoals(event) {
    event.preventDefault()
    await onSave(goalsForm)
  }

  return (
    <>
      <button type="button" className="sheet-backdrop" aria-label="Close goals modal" onClick={onClose} />
      <section className="goals-modal" role="dialog" aria-modal="true" aria-label="Set your goals">
        <h3>Set your daily goals</h3>
        <p className="goals-modal-note">
          You can edit these in the Profile tab at any point.
        </p>
        <form className="goals-modal-form" onSubmit={submitGoals}>
          {metricDefinitions.map((definition) => (
            <label key={definition.key} className="goals-modal-row">
              <span>{definition.label}</span>
              <div className="goals-modal-input-wrap">
                {definition.key === 'moneySpent' && <span className="goals-modal-prefix">£</span>}
                <input
                  type="text"
                  inputMode={definition.increment >= 1 ? 'numeric' : 'decimal'}
                  autoComplete="off"
                  value={goalsForm[definition.key]}
                  onChange={(event) => updateGoal(definition, event.target.value)}
                  required
                />
                {definition.unitLabel && <span className="goals-modal-unit">{definition.unitLabel}</span>}
              </div>
            </label>
          ))}
          {error && <p className="auth-error-text">{error}</p>}
          <div className="goals-modal-actions">
            {!isRequired && (
              <button type="button" className="profile-manage-btn" onClick={onClose} disabled={isSaving}>
                Cancel
              </button>
            )}
            <button type="submit" className="exercise-sheet-done" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Goals'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

function AccountPage({ activeUser, goals, onManageGoals, onSignOut }) {
  if (!activeUser) {
    return <section className="page-card">Loading profile...</section>
  }

  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [joinedRoomCode, setJoinedRoomCode] = useState('')
  const [roomError, setRoomError] = useState('')
  const [isSavingRoom, setIsSavingRoom] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRoomError('')

    requestJson(`/api/users/${activeUser.id}/room`)
      .then((data) => {
        if (cancelled) {
          return
        }

        const roomCode = String(data?.roomCode ?? '').trim().toUpperCase()
        setJoinedRoomCode(roomCode)
        setRoomCodeInput(roomCode)
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setJoinedRoomCode('')
        setRoomCodeInput('')
      })

    return () => {
      cancelled = true
    }
  }, [activeUser.id])

  const joinedDate = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(activeUser.joinDate))

  async function submitRoomCode(event) {
    event.preventDefault()
    setRoomError('')
    const cleanedCode = roomCodeInput.trim().toUpperCase()
    if (!cleanedCode) {
      return
    }

    setIsSavingRoom(true)
    try {
      const data = await requestJson(`/api/users/${activeUser.id}/room`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: cleanedCode }),
      })

      const savedRoomCode = String(data?.roomCode ?? cleanedCode).toUpperCase()
      setJoinedRoomCode(savedRoomCode)
      setRoomCodeInput(savedRoomCode)
    } catch {
      setRoomError('Could not save room code right now.')
    } finally {
      setIsSavingRoom(false)
    }
  }

  async function clearRoomCode() {
    setRoomError('')
    setIsSavingRoom(true)
    try {
      await requestJson(`/api/users/${activeUser.id}/room`, {
        method: 'DELETE',
      })
      setJoinedRoomCode('')
      setRoomCodeInput('')
    } catch {
      setRoomError('Could not leave room right now.')
    } finally {
      setIsSavingRoom(false)
    }
  }

  return (
    <section className="profile-page">
      <header className="profile-page-header">
        <h2>Profile</h2>
        <p>Manage your account and track your journey.</p>
      </header>

      <article className="profile-hero-card">
        <div className="profile-hero-top">
          <div className="profile-hero-left">
            <div className="profile-avatar">{activeUser.name[0]}</div>
            <div>
              <h3>{activeUser.name}</h3>
              <p>Joined {joinedDate}</p>
              <span>{activeUser.streakDays} day streak</span>
            </div>
          </div>
          <div className="profile-hero-actions">
            <button type="button" className="profile-signout-btn" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      </article>

      <article className="profile-goals-card">
        <div className="profile-card-title-row">
          <h3>My Goals</h3>
          <button type="button" className="profile-manage-btn" onClick={onManageGoals}>
            Manage Goals
          </button>
        </div>
        <div className="profile-goals-list">
          {metricDefinitions.map((definition, index) => (
            <article key={definition.key} className="profile-goal-row">
              <div className="profile-goal-main">
                <div className="profile-goal-icon" style={{ color: definition.color }}>
                  <HabitIcon metricKey={definition.key} />
                </div>
                <div>
                  <h4>{definition.label}</h4>
                  <p>{definition.key === 'moneySpent' ? 'Daily goal (under)' : 'Daily goal'}</p>
                </div>
              </div>
              <div className="profile-goal-right">
                {(() => {
                  const goalValue = Number(goals?.[definition.key] ?? definition.goalValue)
                  return (
                    <>
                      <strong style={{ color: definition.color }}>
                        {formatCompareTotal(definition, goalValue)}
                      </strong>
                      <div className="profile-goal-track">
                        <div
                          className="profile-goal-fill"
                          style={{
                            width: `${[72, 85, 74, 76, 58][index] ?? 65}%`,
                            backgroundColor: definition.color,
                          }}
                        />
                      </div>
                    </>
                  )
                })()}
              </div>
            </article>
          ))}
        </div>
      </article>

      <article className="profile-room-card">
        <div className="profile-card-title-row">
          <h3>Room Code</h3>
          {joinedRoomCode && <span className="profile-room-active-label">Connected</span>}
        </div>
        <p className="profile-room-help">
          Enter your friend room code so you&apos;re grouped in the same room.
        </p>
        <form className="profile-room-form" onSubmit={submitRoomCode}>
          <input
            type="text"
            value={roomCodeInput}
            onChange={(event) => setRoomCodeInput(event.target.value)}
            placeholder="e.g. LOCKIN23"
            maxLength={16}
            className="profile-room-input"
          />
          <button
            type="submit"
            className="profile-room-submit-btn"
            disabled={roomCodeInput.trim().length === 0 || isSavingRoom}
          >
            {isSavingRoom ? 'Saving...' : 'Join Room'}
          </button>
        </form>
        {roomError && <p className="auth-error-text">{roomError}</p>}
        {joinedRoomCode && (
          <p className="profile-room-current">
            Current room: <strong>{joinedRoomCode}</strong>
            <button
              type="button"
              className="profile-room-remove-btn"
              aria-label="Leave room"
              onClick={clearRoomCode}
              disabled={isSavingRoom}
            >
              ×
            </button>
          </p>
        )}
      </article>

      <article className="profile-link-card">
        <div className="profile-card-title-row">
          <h3>Support</h3>
        </div>
        <p className="profile-link-copy">Need help with your account or app issues?</p>
        <Link to="/support" className="profile-link-btn">Open Support</Link>
      </article>

      <article className="profile-link-card">
        <div className="profile-card-title-row">
          <h3>Privacy</h3>
        </div>
        <p className="profile-link-copy">Read how Locked In handles your data.</p>
        <Link to="/privacy" className="profile-link-btn">Open Privacy Policy</Link>
      </article>
    </section>
  )
}

function isComplete(definition, value, goalOverride) {
  const goalValue = Number(goalOverride ?? definition.goalValue)
  if (definition.key === 'moneySpent') {
    return value <= goalValue
  }

  return value >= goalValue
}

function getMetricProgress(definition, value, goalOverride) {
  const goalValue = Math.max(0.0001, Number(goalOverride ?? definition.goalValue))
  if (definition.key === 'moneySpent') {
    return Math.max(0, Math.min(100, Math.round(((goalValue - value) / goalValue) * 100)))
  }

  return Math.max(0, Math.min(100, Math.round((value / goalValue) * 100)))
}

function HabitIcon({ metricKey }) {
  if (metricKey === 'waterLiters') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2s-7 7-7 12a7 7 0 0 0 14 0c0-5-7-12-7-12Z" />
      </svg>
    )
  }

  if (metricKey === 'exerciseMinutes') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10v4M7 8v8M17 8v8M21 10v4M7 12h10" />
      </svg>
    )
  }

  if (metricKey === 'steps') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 16c1.5-3 3.5-5.5 6.5-7.5l1 2.5 2.5 1L13 15l-3 1-2 2Z" />
        <path d="M15 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      </svg>
    )
  }

  if (metricKey === 'sleepHours') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 3a8.5 8.5 0 1 0 5 15.4A9 9 0 0 1 16 3Z" />
      </svg>
    )
  }

  if (metricKey === 'moneySpent') {
    return (
      <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 12h.01M17 12h.01M10 12h4" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
      <path d="M7 9V7a5 5 0 0 1 10 0v2" />
      <path d="M12 14h.01" />
    </svg>
  )
}

function DashboardSummaryIcon({ type }) {
  if (type === 'daysCompleted') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 7 9 18l-5-5" />
      </svg>
    )
  }

  if (type === 'averageScore') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v10M7 12h10" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v3a4 4 0 0 0 4 4h0v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-2h0a4 4 0 0 0 4-4V4Z" />
      <path d="M8 20h8" />
    </svg>
  )
}

function BottomNavIcon({ type }) {
  if (type === 'today') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="6.5" />
        <circle cx="12" cy="12" r="1.8" />
        <path d="M12 5V3m0 18v-2m7-7h2M3 12h2" />
        <path d="m16.5 7.5 1.9-1.9" />
      </svg>
    )
  }

  if (type === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 18V12m5 6V7m5 11V9m5 9V5" />
      </svg>
    )
  }

  if (type === 'compare') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="9" r="2.6" />
        <circle cx="16.5" cy="9.5" r="2.3" />
        <path d="M3.8 18.2c.7-2.5 2.7-4 4.8-4s4.1 1.5 4.8 4" />
        <path d="M12.5 18c.6-1.8 2.1-3 3.9-3 1.6 0 3 .9 3.8 2.6" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.3" />
      <path d="M6.3 19c.8-3.1 3-4.8 5.7-4.8 2.7 0 4.9 1.7 5.7 4.8" />
    </svg>
  )
}

export default App
