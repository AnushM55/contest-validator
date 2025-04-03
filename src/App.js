import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './components/HomePage/HomePage';
import ContestPage from './components/ContestPage/ContestPage';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/contest/:id" element={<ContestPage />} />
      </Routes>
    </Router>
  );
}

export default App;