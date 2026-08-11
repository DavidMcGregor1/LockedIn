import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import './App.css'

const metricDefinitions = [
  {
    key: 'waterLiters',
    label: 'Water',
    goalLabel: 'Goal: 3 L',
    goalValue: 3,
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
    goalLabel: 'Goal: under $50',
    goalValue: 50,
    increment: 1,
    color: '#f06f36',
    unitLabel: '',
    displayValue: (value) => `$${value.toFixed(0)}`,
    formatValue: (value) => `$${value.toFixed(2)}`,
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
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.status === 204 ? null : response.json()
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function App() {
  const [users, setUsers] = useState([])
  const [activeUserId, setActiveUserId] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('lockedin-auth') === '1',
  )

  useEffect(() => {
    requestJson('/api/users')
      .then((data) => {
        setUsers(data)
        if (data.length > 0) {
          setActiveUserId(data[0].id)
        }
      })
      .catch(() => setUsers([]))
  }, [])

  const activeUser = useMemo(
    () => users.find((user) => user.id === activeUserId),
    [activeUserId, users],
  )

  function markAuthenticated() {
    localStorage.setItem('lockedin-auth', '1')
    setIsAuthenticated(true)
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
          <Route
            path="/today"
            element={
              isAuthenticated
                ? <TodayPage activeUserId={activeUserId} activeUser={activeUser} />
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
              isAuthenticated ? <ComparePage users={users} /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/account"
            element={
              isAuthenticated ? <AccountPage activeUser={activeUser} /> : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? '/today' : '/login'} replace />} />
        </Routes>
      </main>

      {isAuthenticated && (
        <nav className="bottom-nav">
          <NavLink to="/today">
            <span className="nav-icon">☀</span>
            <span>Today</span>
          </NavLink>
          <NavLink to="/dashboard">
            <span className="nav-icon">▥</span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/compare">
            <span className="nav-icon">◌◌</span>
            <span>Compare</span>
          </NavLink>
          <NavLink to="/account">
            <span className="nav-icon">◯</span>
            <span>Profile</span>
          </NavLink>
        </nav>
      )}
    </div>
  )
}

function LoginPage({ onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  function handleSubmit(event) {
    event.preventDefault()
    onSuccess()
    navigate('/today', { replace: true })
  }

  return (
    <section className="auth-page">
      <header className="auth-header">
        <h2>Welcome back</h2>
        <p>Log in to continue your Lock In streak.</p>
      </header>
      <form className="auth-card" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="auth-submit-btn">
          Log In
        </button>
      </form>
      <p className="auth-switch-text">
        Don&apos;t have an account? <Link to="/signup">Sign up</Link>
      </p>
    </section>
  )
}

function SignupPage({ onSuccess }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  function handleSubmit(event) {
    event.preventDefault()
    onSuccess()
    navigate('/today', { replace: true })
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
          <span>Email</span>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            required
            placeholder="Create a password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="auth-submit-btn">
          Sign Up
        </button>
      </form>
      <p className="auth-switch-text">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </section>
  )
}

function TodayPage({ activeUserId, activeUser }) {
  const [form, setForm] = useState(defaultTodayForm)
  const [selectedExercises, setSelectedExercises] = useState([])
  const [isExerciseSheetOpen, setIsExerciseSheetOpen] = useState(false)
  const [draftExercises, setDraftExercises] = useState([])
  const [showDaySavedPopup, setShowDaySavedPopup] = useState(false)

  const liveStorageKey = useMemo(
    () => (activeUserId ? `lockedin-live-${activeUserId}` : ''),
    [activeUserId],
  )

  useEffect(() => {
    if (!activeUserId || !liveStorageKey) {
      return
    }

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
      })
  }, [activeUserId, liveStorageKey])

  useEffect(() => {
    if (!activeUserId || !liveStorageKey) {
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
  }, [activeUserId, form, selectedExercises, liveStorageKey])

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

  useEffect(() => {
    if (!showDaySavedPopup) {
      return
    }

    const timeoutId = setTimeout(() => setShowDaySavedPopup(false), 1800)
    return () => clearTimeout(timeoutId)
  }, [showDaySavedPopup])

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
      `lockedin-completed-${activeUserId}-${todayIso}`,
      JSON.stringify({
        date: todayIso,
        form,
        selectedExercises,
        completedAt: new Date().toISOString(),
      }),
    )

    setShowDaySavedPopup(true)
  }

  useEffect(() => {
    if (!activeUserId) {
      return
    }

    const todayIso = getTodayIsoDate()
    const completed = localStorage.getItem(`lockedin-completed-${activeUserId}-${todayIso}`)
    if (!completed) {
      return
    }

    try {
      const parsed = JSON.parse(completed)
      if (parsed.form) {
        setForm({ ...defaultTodayForm, ...parsed.form })
      }
      setSelectedExercises(parsed.selectedExercises ?? [])
    } catch {
      // Ignore corrupted completion cache.
    }
  }, [activeUserId])

  useEffect(() => {
    if (!activeUserId) {
      return
    }

    const todayIso = getTodayIsoDate()
    const completionKey = `lockedin-completed-${activeUserId}-${todayIso}`
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
      isComplete(definition, form[definition.key]),
    ).length
    return {
      completed,
      total: metricDefinitions.length,
      percent: Math.round((completed / metricDefinitions.length) * 100),
    }
  }, [form])

  const dateText = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(new Date()),
    [],
  )

  function updateMetric(key, nextValue) {
    setForm((current) => ({
      ...current,
      [key]: Math.max(0, Number(nextValue)),
    }))
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
  }

  if (!activeUser) {
    return <section className="page-card">Loading profile...</section>
  }

  return (
    <section className="today-page">
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
          const progressWidth = getMetricProgress(definition, value)
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
              onClick={isExerciseCard ? openExerciseSheet : undefined}
              role={isExerciseCard ? 'button' : undefined}
              tabIndex={isExerciseCard ? 0 : undefined}
              onKeyDown={
                isExerciseCard
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        openExerciseSheet()
                      }
                    }
                  : undefined
              }
            >
              <div className="habit-row-top">
                <div className="habit-row-main">
                  <div className="habit-icon" style={{ backgroundColor: `${definition.color}16`, color: definition.color }}>
                    <HabitIcon metricKey={definition.key} />
                  </div>
                  <div>
                    <h4>{definition.label.toUpperCase()}</h4>
                    <p className="goal-text">{definition.goalLabel}</p>
                  </div>
                </div>
                <div className="habit-row-right">
                  {isExerciseCard ? (
                    <div className="exercise-selection-pill">
                      {exerciseSelectionText || 'Select'}
                    </div>
                  ) : (
                    <label className="habit-input-field">
                      {definition.key === 'moneySpent' && <span className="money-prefix">$</span>}
                      <input
                        type="number"
                        min="0"
                        step={definition.increment}
                        value={value}
                        onChange={(event) => updateMetric(definition.key, event.target.value)}
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

      <button type="button" className="add-habit">
        <span className="add-habit-plus">+</span> ADD HABIT
      </button>

      <button type="button" className="complete-day-btn" onClick={completeDay}>
        COMPLETE DAY
      </button>

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

      {showDaySavedPopup && <div className="day-saved-popup">Day saved</div>}
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
    averageScore: 0,
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
          <strong>{summary.averageScore}</strong>
          <span>Avg. score</span>
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

function ComparePage({ users }) {
  const range = 'weekly'
  const [compareByMetric, setCompareByMetric] = useState({})

  useEffect(() => {
    let cancelled = false
    const metricKeys = metricDefinitions.map((definition) => definition.key)

    Promise.all(
      metricKeys.map((metricKey) =>
        requestJson(`/api/compare?metric=${metricKey}&range=${range}`)
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
  }, [range])

  const selectedMetricKeys = metricDefinitions.map((definition) => definition.key)
  const periodCount = range === 'weekly' ? 7 : 6
  const periodLabel = range === 'weekly' ? 'days' : 'periods'
  const referenceRows = compareByMetric[selectedMetricKeys[0]] ?? []
  const periods = referenceRows.map((row) => row.period)
  const palette = ['#62e47f', '#3d7cff', '#a65bff', '#f09a47', '#27b2a2']
  const usersByName = users.map((user) => ({
    ...user,
    color: palette[users.indexOf(user) % palette.length],
  }))

  const rankedUsers = usersByName
    .map((user) => {
      const dailyScores = periods.map((period) => {
        const periodScores = selectedMetricKeys.map((metricKey) => {
          const metricRows = compareByMetric[metricKey] ?? []
          const row = metricRows.find((item) => item.period === period)
          const value = Number(row?.[user.name] ?? 0)
          const definition = metricDefinitionByKey[metricKey]
          return getMetricScore(definition, value)
        })

        return average(periodScores)
      })

      const averageScore = Math.round(average(dailyScores))
      const completedPeriods = dailyScores.filter((score) => score >= 60).length

      return {
        ...user,
        averageScore,
        completedPeriods,
      }
    })
    .sort((left, right) => right.averageScore - left.averageScore)

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
          {rankedUsers.slice(0, 3).map((user, index) => (
            <article
              key={user.id}
              className="compare-rank-item"
              style={{
                '--compare-color': user.color,
              }}
            >
              <p className="compare-rank-badge">#{index + 1}</p>
              <h3>{user.name}</h3>
              <strong>{user.averageScore}</strong>
              <p className="compare-rank-label">Avg. Lock In Score</p>
              <div className="compare-rank-progress-track">
                <div
                  className="compare-rank-progress-fill"
                  style={{ width: `${Math.min(100, user.averageScore)}%` }}
                />
              </div>
              <p className="compare-rank-sub">
                {user.completedPeriods} of {periodCount} {periodLabel}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="compare-weekly-card">
        <header className="compare-weekly-head">
          <h3>Weekly Overview</h3>
          <span>{periodCount} {periodLabel}</span>
        </header>
        <div className="compare-weekly-grid">
          <div className="compare-weekly-left">
            {metricDefinitions.map((definition) => (
                <article key={`metric-row-${definition.key}`} className="compare-metric-row">
                  <div className="compare-metric-icon" style={{ color: definition.color }}>
                    <HabitIcon metricKey={definition.key} />
                  </div>
                  <div>
                    <p>{definition.label}</p>
                    <span>{definition.goalLabel.replace('Goal: ', 'Goal: ')}</span>
                  </div>
                </article>
              ))}
          </div>

          {rankedUsers.slice(0, 3).map((user) => (
            <div key={`weekly-col-${user.id}`} className="compare-weekly-user-col">
              <div className="compare-weekly-user-head">
                <span style={{ backgroundColor: `${user.color}35`, color: user.color }}>
                  {user.name[0]}
                </span>
                <strong>{user.name}</strong>
              </div>

              {metricDefinitions.map((definition) => {
                  const rows = compareByMetric[definition.key] ?? []
                  const values = rows.map((row) => Number(row?.[user.name] ?? 0))
                  const total = values.reduce((sum, value) => sum + value, 0)
                  const completionCount = values.filter((value) =>
                    isComplete(definition, value),
                  ).length
                  const best =
                    definition.key === 'moneySpent' && values.length > 0
                      ? Math.min(...values)
                      : null

                  return (
                    <article
                      key={`${definition.key}-${user.id}`}
                      className="compare-weekly-user-metric"
                    >
                      <strong style={{ color: user.color }}>
                        {formatCompareTotal(definition, total)}
                      </strong>
                      <span>
                        {definition.key === 'moneySpent' && best !== null
                          ? `Best: ${formatMoney(best)}`
                          : `${completionCount} of ${periodCount} ${periodLabel}`}
                      </span>
                    </article>
                  )
                })}
            </div>
          ))}
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

function formatMoney(value) {
  return `$${Math.round(value)}`
}

function AccountPage({ activeUser }) {
  if (!activeUser) {
    return <section className="page-card">Loading profile...</section>
  }

  const roomCodeStorageKey = `lockedin-room-${activeUser.id}`
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [joinedRoomCode, setJoinedRoomCode] = useState('')

  useEffect(() => {
    const savedCode = localStorage.getItem(roomCodeStorageKey) ?? ''
    setJoinedRoomCode(savedCode)
    setRoomCodeInput(savedCode)
  }, [roomCodeStorageKey])

  const joinedDate = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(activeUser.joinDate))
  const daysCompleted = activeUser.streakDays + 11
  const averageScore = Math.min(99, 60 + activeUser.streakDays)
  const bestStreak = activeUser.streakDays + 2
  const perfectDays = Math.max(1, Math.round(daysCompleted * 0.2))
  const completionRate = Math.min(99, Math.round((daysCompleted / (daysCompleted + 3)) * 100))
  const profileStats = [
    { key: 'days', icon: '✓', value: daysCompleted, label: 'Days completed', color: '#62e47f' },
    { key: 'score', icon: '✶', value: averageScore, label: 'Avg. score', color: '#a65bff' },
    { key: 'streak', icon: '🏆', value: bestStreak, label: 'Best streak', color: '#f0a63c' },
    { key: 'perfect', icon: '◎', value: perfectDays, label: 'Perfect days', color: '#2c8bff' },
    { key: 'rate', icon: '↗', value: `${completionRate}%`, label: 'Completion rate', color: '#62e47f' },
  ]

  function submitRoomCode(event) {
    event.preventDefault()
    const cleanedCode = roomCodeInput.trim().toUpperCase()
    if (!cleanedCode) {
      return
    }

    localStorage.setItem(roomCodeStorageKey, cleanedCode)
    setJoinedRoomCode(cleanedCode)
    setRoomCodeInput(cleanedCode)
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
          <button type="button" className="profile-edit-btn">
            Edit Profile
          </button>
        </div>

        <div className="profile-stats-grid">
          {profileStats.map((stat) => (
            <article key={stat.key} className="profile-stat-item">
              <span className="profile-stat-icon" style={{ color: stat.color }}>
                {stat.icon}
              </span>
              <strong>{stat.value}</strong>
              <p>{stat.label}</p>
            </article>
          ))}
        </div>
      </article>

      <article className="profile-about-card">
        <div className="profile-card-title-row">
          <h3>About Me</h3>
          <span>✎</span>
        </div>
        <p>Building better habits. One day at a time.</p>
      </article>

      <article className="profile-goals-card">
        <div className="profile-card-title-row">
          <h3>My Goals</h3>
          <button type="button" className="profile-manage-btn">
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
                <strong style={{ color: definition.color }}>
                  {formatCompareTotal(definition, definition.goalValue)}
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
            disabled={roomCodeInput.trim().length === 0}
          >
            Join Room
          </button>
        </form>
        {joinedRoomCode && (
          <p className="profile-room-current">
            Current room: <strong>{joinedRoomCode}</strong>
          </p>
        )}
      </article>
    </section>
  )
}

function isComplete(definition, value) {
  if (definition.key === 'moneySpent') {
    return value <= definition.goalValue
  }

  return value >= definition.goalValue
}

function getMetricProgress(definition, value) {
  if (definition.key === 'moneySpent') {
    return Math.max(0, Math.min(100, Math.round((value / definition.goalValue) * 100)))
  }

  return Math.max(0, Math.min(100, Math.round((value / definition.goalValue) * 100)))
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

export default App
