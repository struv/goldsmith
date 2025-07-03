import React, { useState, useEffect } from 'react';
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

const ScoreSelector = ({ value, onChange, questionIndex }) => {
  return (
    <div className="flex space-x-1">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
        <button
          key={score}
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
  const [userName, setUserName] = useState(localStorage.getItem('goldsmith_user_name') || '');
  const [showWelcome, setShowWelcome] = useState(!localStorage.getItem('goldsmith_user_name'));
  const [activeTab, setActiveTab] = useState('entry');
  const [scores, setScores] = useState(Array(6).fill(null));
  const [data, setData] = useState([]);
  const [binId, setBinId] = useState(localStorage.getItem('goldsmith_bin_id') || '');
  const [loading, setLoading] = useState(false);

  const getTodayPST = () => {
    const now = new Date();
    const pstDate = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    return pstDate.toISOString().split('T')[0];
  };

  const handleWelcomeSubmit = (e) => {
    e.preventDefault();
    if (userName.trim()) {
      localStorage.setItem('goldsmith_user_name', userName.trim());
      setShowWelcome(false);
    }
  };

  const loadData = async () => {
    if (!binId) return;
    
    setLoading(true);
    try {
      const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        headers: {
          'X-Master-Key': '$2a$10$1k.9BsOXYGU9hhEyxu3Ns.FS7nBiXMFOAQCU4D8nZyJYTwM5QWJP6'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        setData(result.record || []);
        
        // Load today's scores if they exist
        const today = getTodayPST();
        const todayEntry = result.record.find(entry => entry.date === today);
        if (todayEntry) {
          setScores(todayEntry.scores);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
    setLoading(false);
  };

  const saveData = async (newData) => {
    if (!binId) {
      // Create new bin
      try {
        const response = await fetch('https://api.jsonbin.io/v3/b', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': '$2a$10$1k.9BsOXYGU9hhEyxu3Ns.FS7nBiXMFOAQCU4D8nZyJYTwM5QWJP6'
          },
          body: JSON.stringify(newData)
        });
        
        const result = await response.json();
        const newBinId = result.metadata.id;
        setBinId(newBinId);
        localStorage.setItem('goldsmith_bin_id', newBinId);
      } catch (error) {
        console.error('Failed to create bin:', error);
        return;
      }
    } else {
      // Update existing bin
      try {
        await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': '$2a$10$1k.9BsOXYGU9hhEyxu3Ns.FS7nBiXMFOAQCU4D8nZyJYTwM5QWJP6'
          },
          body: JSON.stringify(newData)
        });
      } catch (error) {
        console.error('Failed to save data:', error);
      }
    }
  };

  const handleSubmit = async () => {
    const today = getTodayPST();
    
    const newEntry = {
      date: today,
      scores: scores
    };
    
    const updatedData = data.filter(entry => entry.date !== today);
    updatedData.push(newEntry);
    updatedData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    setData(updatedData);
    await saveData(updatedData);
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

  useEffect(() => {
    if (!showWelcome) {
      loadData();
    }
  }, [binId, showWelcome]);

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

        {activeTab === 'entry' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-medium text-gray-900 mb-6">
              {getTodayPST()}
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
                    questionIndex={index}
                  />
                </div>
              ))}
            </div>
            
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-8 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save Entry'}
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
                      tickFormatter={(date) => new Date(date).toLocaleDateString()}
                    />
                    <YAxis 
                      domain={[1, 10]} 
                      stroke="#666"
                      fontSize={12}
                    />
                    <Tooltip 
                      labelFormatter={(date) => new Date(date).toLocaleDateString()}
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
        
        {!binId && (
          <div className="mt-4 text-center text-sm text-gray-500">
            Your data will be automatically saved to a secure cloud storage after your first entry.
          </div>
        )}
      </div>
    </div>
  );
}