import { useState, useEffect, useRef } from 'react';
import { loadScores, saveScore, todayInLosAngeles, formatEntryDate } from './lib/scores';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const QUESTIONS = [
  "Did I do my best to set clear goals?",
  "Did I do my best to make progress towards my goals?", 
  "Did I do my best to find meaning?",
  "Did I do my best to be happy?",
  "Did I do my best to build positive relationships?",
  "Did I do my best to be fully engaged?"
];

const COLORS = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5AC8FA'];

const ScoreSelector = ({ value, onChange, disabled }) => {
  return (
    <div className="flex space-x-1">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
        <button
          key={score}
          type="button"
          disabled={disabled}
          aria-pressed={value === score}
          onClick={() => onChange(score)}
          className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
            value === score
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {score}
        </button>
      ))}
    </div>
  );
};

export default function GoldsmithTracker() {
  const [userName, setUserName] = useState(() => localStorage.getItem('goldsmith_user_name') || '');
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('goldsmith_user_name'));
  const [activeTab, setActiveTab] = useState('entry');
  const [scores, setScores] = useState(Array(6).fill(null));
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);
  const [hasEarlierStorage] = useState(() => Boolean(localStorage.getItem('goldsmith_bin_id')));

  const handleWelcomeSubmit = (event) => {
    event.preventDefault();
    if (userName.trim()) {
      localStorage.setItem('goldsmith_user_name', userName.trim());
      setUserName(userName.trim());
      setShowWelcome(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const entries = await loadScores(controller.signal);
        if (controller.signal.aborted) return;
        setData(entries);
        setScores(entries.find(entry => entry.date === todayInLosAngeles())?.scores || Array(6).fill(null));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause.message || 'Your scores could not be loaded. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [reload]);

  const handleSubmit = async () => {
    if (savingRef.current || loading || scores.every(score => score === null)) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const entries = await saveScore({ date: todayInLosAngeles(), scores });
      setData(entries);
      setNotice('Entry saved.');
    } catch (cause) {
      setError(cause.message || 'Your entry could not be saved. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const formatChartData = () => {
    return data.map(entry => {
      const formatted = { date: entry.date };
      entry.scores.forEach((score, index) => {
        if (score !== null) {
          formatted[`Q${index + 1}`] = score;
        }
      });
      return formatted;
    });
  };

  if (showWelcome) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light text-gray-900 mb-2">Welcome</h1>
            <p className="text-gray-600">Let's start tracking your daily growth</p>
          </div>
          
          <form onSubmit={handleWelcomeSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-900 font-medium mb-2">
                What's your name?
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                required
              />
            </div>
            
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Get Started
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light text-gray-900 mb-2">Daily Questions</h1>
          <p className="text-gray-600">Hello, {userName}</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-gray-100 rounded-lg p-1 mb-8 max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('entry')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'entry' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Today's Entry
          </button>
          <button
            onClick={() => setActiveTab('trends')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'trends' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Trends
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
            <p>{error}</p>
            <button type="button" disabled={loading || saving} onClick={() => setReload(value => value + 1)} className="mt-2 underline">
              Reload saved scores
            </button>
          </div>
        )}
        {notice && <p role="status" className="mb-4 text-center text-green-800">{notice}</p>}

        {activeTab === 'entry' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-medium text-gray-900 mb-6">
              {todayInLosAngeles()}
            </h2>
            
            <div className="space-y-8">
              {QUESTIONS.map((question, index) => (
                <div key={index} className="space-y-3">
                  <label className="block text-gray-900 font-medium">
                    {question}
                  </label>
                  <ScoreSelector
                    value={scores[index]}
                    onChange={(score) => {
                      const newScores = [...scores];
                      newScores[index] = score;
                      setScores(newScores);
                    }}
                    disabled={loading || saving}
                  />
                </div>
              ))}
            </div>
            
            <button
              onClick={handleSubmit}
              disabled={loading || saving || scores.every(score => score === null)}
              className="w-full mt-8 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : loading ? 'Loading...' : 'Save Entry'}
            </button>
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-medium text-gray-900 mb-6">Progress Over Time</h2>
            
            {data.length > 0 ? (
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formatChartData()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#666"
                      fontSize={12}
                      tickFormatter={(date) => formatEntryDate(date)}
                    />
                    <YAxis 
                      domain={[1, 10]} 
                      stroke="#666"
                      fontSize={12}
                    />
                    <Tooltip 
                      labelFormatter={(date) => formatEntryDate(date)}
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    {QUESTIONS.map((_, index) => (
                      <Line
                        key={index}
                        type="monotone"
                        dataKey={`Q${index + 1}`}
                        stroke={COLORS[index]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        connectNulls={false}
                        name={`Question ${index + 1}`}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                No data yet. Complete your first daily entry to see trends.
              </div>
            )}
          </div>
        )}
        
        <p className="mt-4 text-center text-sm text-gray-500">
          This browser keeps access to your saved scores. Clearing its cookies loses that access.
        </p>
        {hasEarlierStorage && (
          <p className="mt-2 text-center text-sm text-gray-500">
            This update starts new storage. Scores from the previous account have not been imported.
          </p>
        )}
      </div>
    </div>
  );
}
