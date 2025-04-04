import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './HomePage.css';

const HomePage = () => {
  const navigate = useNavigate();
  const [contestId, setContestId] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    // Simulate API check with timeout
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Hardcoded ID check - for this example, we use "12345"
    if (contestId === 'SS2023-28') {
      navigate(`/contest/${contestId}`);
    } else {
      setError('Invalid contest ID. Try "12345".');
    }
    setIsLoading(false);
  };

  return (
    <div className="home-container">
      <div className="home-card">
        <div className="logo-container">
          <div className="logo">C</div>
        </div>
        
        <h1 className="home-title">Contest Portal</h1>
        <p className="home-subtitle">Enter your contest ID to access your event</p>
        
        <form onSubmit={handleSubmit} className="home-form">
          <div className="input-container">
            <input
              type="text"
              value={contestId}
              onChange={(e) => setContestId(e.target.value)}
              placeholder="Contest ID"
              className="home-input"
              disabled={isLoading}
            />
            <label className="floating-label">Contest ID</label>
          </div>
          
          <button 
            type="submit" 
            className="home-button"
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : 'Enter Contest'}
          </button>
        </form>
        
        {error && <p className="home-error">{error}</p>}
        
        <div className="home-footer">
          <p>Need help? <button onClick={() => alert('Support contact not implemented yet.')} className="support-link button-as-link">Contact Support</button></p>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
