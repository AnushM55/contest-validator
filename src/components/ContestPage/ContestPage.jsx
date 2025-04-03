import { useParams, Link } from 'react-router-dom';
import { useState, useRef } from 'react';
import './ContestPage.css';

const ContestPage = () => {
  const { id } = useParams();
  const [selectedMilestone, setSelectedMilestone] = useState('1');
  const [selectedTestCase, setSelectedTestCase] = useState('1');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  
  // Available milestones for this contest
  const milestones = ['1', '2', '3'];
  
  // Available test cases for each milestone
  const testCases = ['1', '2', '3', '4', '5'];
  
  const handleMilestoneChange = (e) => {
    setSelectedMilestone(e.target.value);
    // Reset test case and uploaded file when milestone changes
    setSelectedTestCase('1');
    setUploadedFile(null);
  };
  
  const handleTestCaseChange = (e) => {
    setSelectedTestCase(e.target.value);
    // Reset uploaded file when test case changes
    setUploadedFile(null);
  };
  
  const handleDownloadClick = async () => {
    setIsDownloading(true);
    
    // Simulate download delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // In a real app, this would be replaced with actual file download logic
    // e.g. fetch(`/api/contests/${id}/milestones/${selectedMilestone}/testcases/${selectedTestCase}/input`)
    
    const dummyData = "timestamp,value,category\n2023-01-01,45,A\n2023-01-02,23,B\n2023-01-03,67,A";
    const blob = new Blob([dummyData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contest_${id}_milestone_${selectedMilestone}_testcase_${selectedTestCase}_input.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setIsDownloading(false);
  };
  
  const handleUploadClick = () => {
    fileInputRef.current.click();
  };
  
  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Check if file is CSV
      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        alert('Please upload a CSV file');
        return;
      }
      
      setIsUploading(true);
      
      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // In a real app, this would upload the file to a server
      // const formData = new FormData();
      // formData.append('file', file);
      // await fetch(`/api/contests/${id}/milestones/${selectedMilestone}/testcases/${selectedTestCase}/submission`, {
      //   method: 'POST',
      //   body: formData
      // });
      
      setUploadedFile(file);
      setIsUploading(false);
    }
  };
  
  return (
    <div className="contest-container">
      <div className="contest-header">
        <Link to="/" className="back-button">← Back</Link>
        <div className="contest-id-badge">Contest ID: {id}</div>
      </div>
      
      <div className="contest-card">
        <h1 className="contest-title">Contest Dashboard</h1>
        <p className="contest-subtitle">Complete milestone tasks to progress in the competition</p>
        
        <div className="selectors-container">
          <div className="selector-group">
            <label htmlFor="milestone">Select Milestone:</label>
            <select 
              id="milestone" 
              value={selectedMilestone} 
              onChange={handleMilestoneChange}
              className="select-input"
            >
              {milestones.map(milestone => (
                <option key={milestone} value={milestone}>
                  Milestone {milestone}
                </option>
              ))}
            </select>
          </div>
          
          <div className="selector-group">
            <label htmlFor="testCase">Select Test Case:</label>
            <select 
              id="testCase" 
              value={selectedTestCase} 
              onChange={handleTestCaseChange}
              className="select-input"
            >
              {testCases.map(testCase => (
                <option key={testCase} value={testCase}>
                  Test Case {testCase}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="milestone-details">
          <h2>Milestone {selectedMilestone} - Test Case {selectedTestCase}</h2>
          <p>
            Complete the following tasks for Milestone {selectedMilestone}, Test Case {selectedTestCase}. 
            Download the input file, process it according to the contest rules, 
            and upload your output file.
          </p>
        </div>
        
        <div className="contest-actions">
          <button 
            className="download-button" 
            onClick={handleDownloadClick}
            disabled={isDownloading}
          >
            {isDownloading ? 'Downloading...' : 'Download Input File'}
          </button>
          
          <button 
            className="upload-button" 
            onClick={handleUploadClick}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload Your Output File'}
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            style={{ display: 'none' }}
            accept=".csv"
          />
        </div>
        
        {uploadedFile && (
          <div className="upload-success">
            <div className="file-icon">✓</div>
            <div className="file-details">
              <span className="file-name">{uploadedFile.name}</span>
              <span className="file-size">
                {(uploadedFile.size / 1024).toFixed(2)} KB
              </span>
              <span className="file-details-info">
                For Milestone {selectedMilestone}, Test Case {selectedTestCase}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContestPage;