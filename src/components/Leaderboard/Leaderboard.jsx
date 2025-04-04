import React, { useState, useEffect } from 'react';
import './Leaderboard.css';

// Helper function to get the API base URL
const getApiBaseUrl = () => {
  // Use REACT_APP_API_BASE_URL if available (for production/staging), otherwise default to localhost
  // Ensure this environment variable is set in your deployment environment
  // and potentially in a .env file for local development (e.g., .env.development).
  return process.env.REACT_APP_API_BASE_URL || 'http://localhost:8787'; // Default to Cloudflare Worker local dev port
};

const Leaderboard = ({ contestId, userToken }) => {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const apiBaseUrl = getApiBaseUrl();

  useEffect(() => {
    if (!contestId || !userToken) {
      // Don't fetch if contestId or token is missing
      setIsLoading(false);
      setError('Contest ID or User Token not provided.');
      return;
    }

    const fetchLeaderboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`${apiBaseUrl}/api/leaderboard/${contestId}`, {
          headers: {
            'Authorization': `Bearer ${userToken}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
        // Ensure data is an array before setting state
        if (Array.isArray(data)) {
          setLeaderboardData(data);
        } else {
          console.error("Received non-array data for leaderboard:", data);
          setLeaderboardData([]); // Set to empty array if data is not as expected
          setError('Received invalid data format from server.');
        }
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        setError(err.message || 'Failed to fetch leaderboard data.');
        setLeaderboardData([]); // Clear data on error
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [contestId, userToken, apiBaseUrl]); // Re-fetch if contestId, token, or baseUrl changes

  if (isLoading) {
    return <div className="leaderboard-loading">Loading Leaderboard...</div>;
  }

  if (error) {
    return <div className="leaderboard-error">Error: {error}</div>;
  }

  if (leaderboardData.length === 0) {
    return <div className="leaderboard-empty">No leaderboard data available yet.</div>;
  }

  return (
    <div className="leaderboard-container">
      <h2>Leaderboard</h2>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {leaderboardData.map((entry, index) => (
            <tr key={entry.userId || index}> {/* Use userId as key, fallback to index */}
              <td>{index + 1}</td>
              {/* Display 'Anonymous' if name is missing */}
              <td>{entry.name || 'Anonymous'}</td>
              <td>{entry.totalScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Leaderboard;
