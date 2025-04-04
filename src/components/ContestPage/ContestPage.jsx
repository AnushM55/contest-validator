import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { gapi } from 'gapi-script'; // Import gapi-script
import Papa from 'papaparse';
import './ContestPage.css';

// --- Google API Configuration ---
const CLIENT_ID = '858518359438-du502hhi85fsdmnmfobv1hlpchilmaq8.apps.googleusercontent.com';
const API_KEY = 'AIzaSyB3OYI6x559zdcm1ur8mB92lCU4ZpuKJu4';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";
// --- ---

// --- Contest Configuration ---
const CONTEST_FOLDER_ID = '1XIczCfBsCFcuJ-4zgE85UNrUcN_DqsM_';
const EXPECTED_OUTPUT_COLUMN = 'outout'; // Column name in Drive CSV
const USER_ANSWER_COLUMN = 'output'; // Column name in User's CSV
// --- --

// Filename parsing regex (adjust if convention differs)
const PROBLEM_REGEX = /Problem_M(\d+)\.pdf$/i;
const TESTCASE_REGEX = /TestCase_M(\d+)_T(\d+)\.csv$/i;

const ContestPage = () => {
  const { id } = useParams();
  // State for selected values
  const [selectedMilestone, setSelectedMilestone] = useState(''); // Default to empty, set after fetch
  const [selectedTestCase, setSelectedTestCase] = useState(''); // Default to empty, set after fetch
  // State for available options, populated from Drive
  const [availableMilestones, setAvailableMilestones] = useState([]); // e.g., ['1', '2']
  const [availableTestCases, setAvailableTestCases] = useState([]); // Test cases for the selected milestone e.g., ['1', '2', '3']
  // State to hold all fetched file metadata
  const [allFiles, setAllFiles] = useState([]); // Store all file objects from the list call

  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDownloadingInput, setIsDownloadingInput] = useState(false);
  const [isDownloadingStatement, setIsDownloadingStatement] = useState(false);
  const [isUploading, setIsUploading] = useState(false); // Tracks scoring process
  const [isLoadingFiles, setIsLoadingFiles] = useState(false); // Now tracks file loading *after* sign-in
  const [driveError, setDriveError] = useState(null);
  const [problemStatementFile, setProblemStatementFile] = useState(null); // Currently selected PDF file object
  const [testCaseInputFile, setTestCaseInputFile] = useState(null); // Currently selected CSV file object
  const [score, setScore] = useState(null);
  const fileInputRef = useRef(null);

  // --- Google Auth State ---
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Tracks initial auth check
  const [authError, setAuthError] = useState(null);
  const [userName, setUserName] = useState('');
  // --- ---
  
  // Remove hardcoded lists
  // const milestones = ['1', '2', '3'];
  // const testCases = ['1', '2', '3', '4', '5'];
  
  // Handler for Milestone dropdown change
  const handleMilestoneChange = (e) => {
    const newMilestone = e.target.value;
    console.log("Milestone selected:", newMilestone);
    setSelectedMilestone(newMilestone);
    // Test cases and selected files will be updated by the useEffect hooks
    // Resetting selected test case here might cause a brief inconsistent state,
    // the useEffect hook depending on selectedMilestone handles it.
  };

  // Handler for Test Case dropdown change
  const handleTestCaseChange = (e) => {
    const newTestCase = e.target.value;
    console.log("Test Case selected:", newTestCase);
    setSelectedTestCase(newTestCase);
    // Selected files will be updated by the useEffect hook depending on selectedTestCase
  };

  // --- Google API Initialization and Auth Handling ---
  useEffect(() => {
    const initClient = async () => {
      try {
        await gapi.client.init({
          apiKey: API_KEY,
          clientId: CLIENT_ID,
          discoveryDocs: DISCOVERY_DOCS,
          scope: SCOPES,
        });
        setIsGapiLoaded(true);
        console.log("GAPI client initialized.");

        // Listen for sign-in state changes.
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);

        // Handle the initial sign-in state.
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
      } catch (error) {
        console.error("Error initializing GAPI client:", error);
        setAuthError(`Error initializing Google API: ${error.message || JSON.stringify(error)}`);
        setIsAuthLoading(false); // Stop loading on error
      }
    };

    const updateSigninStatus = (signedIn) => {
      setIsSignedIn(signedIn);
      setIsAuthLoading(false); // Initial auth check complete
      setAuthError(null); // Clear previous auth errors on status change
      if (signedIn) {
        console.log("User is signed in.");
        // Get user profile information
        const profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
        setUserName(profile.getName());
        // Clear file/score state from previous sessions/users
        setProblemStatementFile(null);
        setTestCaseInputFile(null);
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
      } else {
        console.log("User is signed out.");
        setUserName('');
        // Clear data when user signs out
        setProblemStatementFile(null);
        setTestCaseInputFile(null);
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
        setIsLoadingFiles(false); // Stop file loading if user signs out
      }
    };

    // Load the GAPI client and auth2 module
    gapi.load('client:auth2', initClient);

  }, []); // Run only once on component mount

  // --- Sign-in/Sign-out Handlers ---
  const handleAuthClick = () => {
    if (!isGapiLoaded) return;
    setIsAuthLoading(true); // Show loading during sign-in attempt
    gapi.auth2.getAuthInstance().signIn().catch(err => {
        console.error("Sign-in error:", err);
        setAuthError(`Sign-in failed: ${err.error || err.message || 'Unknown error'}`);
        setIsAuthLoading(false); // Stop loading on error
    });
  };

  const handleSignoutClick = () => {
    if (!isGapiLoaded) return;
    gapi.auth2.getAuthInstance().signOut();
  };
  // --- ---


  // --- Fetch Drive Files & Parse Milestones/TestCases ---
  useEffect(() => {
    const fetchAndParseFiles = async () => {
      if (!isGapiLoaded || !isSignedIn || !CONTEST_FOLDER_ID) {
        setAllFiles([]);
        setAvailableMilestones([]);
        setAvailableTestCases([]);
        setSelectedMilestone('');
        setSelectedTestCase('');
        setProblemStatementFile(null);
        setTestCaseInputFile(null);
        setIsLoadingFiles(false);
        return;
      }

      setIsLoadingFiles(true);
      setDriveError(null);
      setAllFiles([]); // Clear previous file list

      try {
        console.log(`Fetching all files from folder: ${CONTEST_FOLDER_ID} using GAPI`);
        let allFetchedFiles = [];
        let pageToken = undefined;
        // Loop to handle pagination if there are many files
        do {
          const response = await gapi.client.drive.files.list({
            q: `'${CONTEST_FOLDER_ID}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink)',
            spaces: 'drive',
            pageSize: 100, // Fetch up to 100 items per page
            pageToken: pageToken,
          });
          
          const result = response.result;
          if (result.files) {
            allFetchedFiles = allFetchedFiles.concat(result.files);
          }
          pageToken = result.nextPageToken;
        } while (pageToken);

        console.log("Total files fetched via GAPI:", allFetchedFiles.length, allFetchedFiles);
        setAllFiles(allFetchedFiles); // Store all files

        // Parse filenames to find available milestones
        const milestonesSet = new Set();
        allFetchedFiles.forEach(file => {
          const problemMatch = file.name?.match(PROBLEM_REGEX);
          const testcaseMatch = file.name?.match(TESTCASE_REGEX);
          if (problemMatch) {
            milestonesSet.add(problemMatch[1]); // Add milestone number from PDF
          }
          if (testcaseMatch) {
            milestonesSet.add(testcaseMatch[1]); // Add milestone number from CSV
          }
        });

        const sortedMilestones = Array.from(milestonesSet).sort((a, b) => parseInt(a) - parseInt(b));
        setAvailableMilestones(sortedMilestones);
        console.log("Available Milestones:", sortedMilestones);

        // Set the first milestone as selected by default
        if (sortedMilestones.length > 0) {
          setSelectedMilestone(sortedMilestones[0]);
          // Note: Updating test cases and selected files will happen in separate useEffect hooks
        } else {
            setSelectedMilestone('');
            setAvailableTestCases([]);
            setSelectedTestCase('');
            setProblemStatementFile(null);
            setTestCaseInputFile(null);
            setDriveError("No valid milestone files (e.g., Problem_M1.pdf or TestCase_M1_T1.csv) found in the folder.");
        }

      } catch (error) {
        console.error("Error fetching/parsing Google Drive files via GAPI:", error);
        const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
        setDriveError(`Error fetching/parsing files: ${errorDetails}`);
        setAllFiles([]); // Clear files on error
        setAvailableMilestones([]);
        setAvailableTestCases([]);
        setSelectedMilestone('');
        setSelectedTestCase('');
      } finally {
        setIsLoadingFiles(false);
      }
    };

    fetchAndParseFiles();
    // Depend on sign-in status and GAPI load status
  }, [isGapiLoaded, isSignedIn]);


  // --- Effect to Update Test Cases when Milestone Changes ---
  useEffect(() => {
    if (!selectedMilestone || allFiles.length === 0) {
      setAvailableTestCases([]);
      setSelectedTestCase('');
      return;
    }

    console.log(`Updating test cases for Milestone ${selectedMilestone}`);
    const testCasesSet = new Set();
    allFiles.forEach(file => {
      const match = file.name?.match(TESTCASE_REGEX);
      // Check if the milestone number in the filename matches the selected milestone
      if (match && match[1] === selectedMilestone) {
        testCasesSet.add(match[2]); // Add the test case number
      }
    });

    const sortedTestCases = Array.from(testCasesSet).sort((a, b) => parseInt(a) - parseInt(b));
    setAvailableTestCases(sortedTestCases);
    console.log(`Available Test Cases for M${selectedMilestone}:`, sortedTestCases);

    // Set the first test case as selected by default for the new milestone
    if (sortedTestCases.length > 0) {
      setSelectedTestCase(sortedTestCases[0]);
    } else {
      setSelectedTestCase('');
      console.warn(`No test cases found for Milestone ${selectedMilestone}`);
    }
    // Reset upload/score state when milestone changes
    setUploadedFile(null);
    setScore(null);

  }, [selectedMilestone, allFiles]); // Re-run when milestone or the list of all files changes


  // --- Effect to Update Selected Files based on M/T selection ---
  useEffect(() => {
    if (!selectedMilestone || !selectedTestCase || allFiles.length === 0) {
      setProblemStatementFile(null);
      setTestCaseInputFile(null);
      return;
    }

    console.log(`Finding files for M${selectedMilestone} T${selectedTestCase}`);
    // Find the corresponding problem statement PDF
    const pdf = allFiles.find(file => {
        const match = file.name?.match(PROBLEM_REGEX);
        return match && match[1] === selectedMilestone;
    });
    setProblemStatementFile(pdf || null);
    if (!pdf) console.warn(`Problem PDF for M${selectedMilestone} not found.`);

    // Find the corresponding test case CSV
    const csv = allFiles.find(file => {
        const match = file.name?.match(TESTCASE_REGEX);
        return match && match[1] === selectedMilestone && match[2] === selectedTestCase;
    });
    setTestCaseInputFile(csv || null);
     if (!csv) console.warn(`Test Case CSV for M${selectedMilestone} T${selectedTestCase} not found.`);

     // Reset upload/score state when test case changes
     setUploadedFile(null);
     setScore(null);

  }, [selectedMilestone, selectedTestCase, allFiles]); // Re-run when selection or files change


  // --- Download Problem Statement (Using GAPI) ---
  const handleDownloadStatementClick = async () => {
      if (!problemStatementFile || !isSignedIn) return; // Need to be signed in

      setIsDownloadingStatement(true);
      setDriveError(null);
      console.log("Attempting to download/view statement:", problemStatementFile);

      // Simplest approach: Open the webViewLink which should always be available
      // Direct download via webContentLink or fetch requires more complex token handling/CORS
      if (problemStatementFile.webViewLink) {
          console.log("Opening webViewLink:", problemStatementFile.webViewLink);
          window.open(problemStatementFile.webViewLink, '_blank');
      } else {
          console.warn("No webViewLink found for:", problemStatementFile.id);
          // Attempt to fetch metadata explicitly if link is missing (less common)
          try {
                  const response = await gapi.client.drive.files.get({
                      fileId: problemStatementFile.id,
                      fields: 'webViewLink' // Only need webViewLink for fallback
                  });
                  const metadata = response.result;
                  if (metadata.webViewLink) {
                      console.log("Opening link from explicit metadata fetch:", metadata.webViewLink);
                      window.open(metadata.webViewLink, '_blank');
                  } else {
                      setDriveError('Could not find a view link even after fetching metadata.');
                  }
              } catch (error) {
                  console.error("Error getting statement metadata via GAPI:", error);
                  const errorDetails = error.result?.error?.message || error.message || 'Unknown error';
                  setDriveError(`Failed to get statement link: ${errorDetails}`);
              }
      }
      setIsDownloadingStatement(false);
  };


  // --- Download Test Case Input File (Using GAPI) ---
  const handleDownloadInputClick = async () => {
    if (!testCaseInputFile || !isSignedIn) return; // Need to be signed in

    setIsDownloadingInput(true);
    setDriveError(null);
    console.log("Attempting to download input file via GAPI:", testCaseInputFile);

    try {
        // Use gapi.client.drive.files.get with alt=media
        const response = await gapi.client.drive.files.get({
            fileId: testCaseInputFile.id,
            alt: 'media'
        });

        console.log("GAPI get file content response:", response);
        const fileContent = response.body; // The raw file content string

        if (typeof fileContent !== 'string') {
            throw new Error('Invalid content received from Google Drive API.');
        }

        // Parse the fetched content to filter out the expected output column
        const parseResult = await parseCsv(fileContent);
        if (!Array.isArray(parseResult)) {
             throw new Error('Failed to parse the downloaded CSV data.');
        }

        // Create a new array of objects, omitting the expected output column
        const filteredData = parseResult.map(row => {
            const newRow = { ...row };
            delete newRow[EXPECTED_OUTPUT_COLUMN]; // Remove the answer column
            return newRow;
        });

        // Unparse the filtered data back into a CSV string
        const filteredCsvString = Papa.unparse(filteredData);

        // Create blob from the filtered CSV string
        const blob = new Blob([filteredCsvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = testCaseInputFile.name || `contest_${id}_input.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log("Input file download initiated via GAPI:", a.download);

    } catch (error) {
        console.error("Error downloading input file via GAPI:", error);
        const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
        setDriveError(`Error downloading input file: ${errorDetails}`);
    } finally {
        setIsDownloadingInput(false);
    }
  };

  const handleUploadClick = () => {
    // Reset previous state before opening file dialog
    setUploadedFile(null);
    setScore(null);
    setDriveError(null);
    fileInputRef.current.value = null; // Allow selecting the same file again
    fileInputRef.current.click();
  };

  // Helper function to parse CSV data using PapaParse
  const parseCsv = (fileOrString) => {
    return new Promise((resolve, reject) => {
      Papa.parse(fileOrString, {
        header: true, // Use the first row as headers
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            console.error("CSV Parsing Errors:", results.errors);
            // Try to resolve with data anyway, but log error
            // reject(new Error(`CSV Parsing Error: ${results.errors[0].message}`));
          }
          // Ensure data is an array, even if parsing failed partially
          resolve(Array.isArray(results.data) ? results.data : []);
        },
        error: (error) => {
          console.error("PapaParse Error:", error);
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        }
      });
    });
  };


  // Function to calculate score (Using GAPI for expected output)
  const calculateScore = async (userFile) => {
      if (!userFile || !testCaseInputFile || !isSignedIn) {
          setDriveError("Missing user file, test case file information, or not signed in.");
          return;
      }

      console.log("Starting score calculation...");
      setIsUploading(true); // Use isUploading state to indicate scoring process
      setScore(null);
      setDriveError(null);

      try {
          // 1. Fetch expected data from Google Drive using GAPI
          console.log("Fetching expected data from Drive via GAPI:", testCaseInputFile.id);
          const driveResponse = await gapi.client.drive.files.get({
              fileId: testCaseInputFile.id,
              alt: 'media'
          });
          // No console.log here as response body can be large
          const expectedCsvString = driveResponse.body;
          if (typeof expectedCsvString !== 'string') {
              throw new Error('Invalid expected output content received from Google Drive API.');
          }
          // console.log("Fetched expected CSV string length:", expectedCsvString.length); // Avoid logging potentially large string

          // 2. Read user's uploaded file
          const userCsvString = await userFile.text();
          console.log("Read user CSV string length:", userCsvString.length);

          // 3. Parse both CSVs
          console.log("Parsing CSVs...");
          const [expectedData, userData] = await Promise.all([
              parseCsv(expectedCsvString),
              parseCsv(userCsvString)
          ]);
          console.log("Parsed Expected Data (first 5 rows):", expectedData.slice(0, 5));
          console.log("Parsed User Data (first 5 rows):", userData.slice(0, 5));


          // 4. Compare and Score
          if (!Array.isArray(expectedData) || !Array.isArray(userData)) {
              throw new Error("Parsed data is not in the expected array format.");
          }
          if (expectedData.length === 0) {
              throw new Error("Expected output file is empty or could not be parsed correctly.");
          }
           if (userData.length === 0) {
              throw new Error("Your uploaded file is empty or could not be parsed correctly.");
          }
          // Check for header presence (simple check for expected column name)
          if (!expectedData[0] || !(EXPECTED_OUTPUT_COLUMN in expectedData[0])) {
               throw new Error(`Missing required header '${EXPECTED_OUTPUT_COLUMN}' in the expected output file.`);
          }
           if (!userData[0] || !(USER_ANSWER_COLUMN in userData[0])) {
               throw new Error(`Missing required header '${USER_ANSWER_COLUMN}' in your uploaded file.`);
          }

          if (userData.length !== expectedData.length) {
              console.warn(`Row count mismatch: Expected ${expectedData.length}, User ${userData.length}. Scoring based on common rows.`);
              // Optional: Set an error or just score based on the shorter length
              // setDriveError(`Row count mismatch: Expected ${expectedData.length}, User ${userData.length}.`);
          }

          let correctMatches = 0;
          const comparisonLength = Math.min(userData.length, expectedData.length);

          for (let i = 0; i < comparisonLength; i++) {
              const userRow = userData[i];
              const expectedRow = expectedData[i];

              // Compare values (trim whitespace and treat as strings for simple comparison)
              const userAnswer = String(userRow[USER_ANSWER_COLUMN] ?? '').trim();
              const expectedAnswer = String(expectedRow[EXPECTED_OUTPUT_COLUMN] ?? '').trim();

              if (userAnswer === expectedAnswer) {
                  correctMatches++;
              }
          }

          // Calculate score (percentage based on expected length)
          const calculatedScore = (correctMatches / expectedData.length) * 100;
          console.log(`Score calculated: ${correctMatches} / ${expectedData.length} = ${calculatedScore}`);
          setScore(calculatedScore);

      } catch (error) {
          console.error("Error during scoring:", error);
          // Use consistent error message extraction
          const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
          setDriveError(`Scoring Error: ${errorDetails}`);
          setScore(null); // Ensure score is null on error
      } finally {
          setIsUploading(false); // Scoring process finished
      }
  };


  // Updated handleFileChange to trigger scoring
  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      // Check if file is CSV
      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        alert('Please upload a CSV file');
        return;
      }

      setUploadedFile(file); // Set the file state immediately for UI feedback
      await calculateScore(file); // Trigger scoring process
    }
  };

  return (
    <div className="contest-container">
      <div className="contest-header">
        <Link to="/" className="back-button">← Back</Link>
        {/* Google Auth Button/Status */}
        <div className="auth-section">
            {isAuthLoading ? (
                <span>Loading Auth...</span>
            ) : isSignedIn ? (
                <>
                    <span>Welcome, {userName}!</span>
                    <button onClick={handleSignoutClick} className="auth-button signout-button">Sign Out</button>
                </>
            ) : (
                <button onClick={handleAuthClick} className="auth-button signin-button" disabled={!isGapiLoaded}>
                    Sign In with Google
                </button>
            )}
             {authError && <span className="auth-error"> Auth Error: {authError}</span>}
        </div>
        <div className="contest-id-badge">Contest ID: {id}</div>
      </div>
      
      <div className="contest-card">
        <h1 className="contest-title">Contest Dashboard</h1>
        <p className="contest-subtitle">Sign in with Google to access contest files and submit your results.</p>
        
        {/* Only show contest details if signed in */}
        {isSignedIn && isGapiLoaded && (
          <>
            <div className="selectors-container">
          <div className="selector-group">
            <label htmlFor="milestone">Select Milestone:</label>
            <select
              id="milestone"
              value={selectedMilestone}
              onChange={handleMilestoneChange}
              className="select-input"
              disabled={availableMilestones.length === 0} // Disable if no milestones found
            >
              <option value="" disabled>-- Select Milestone --</option>
              {availableMilestones.map(m => (
                <option key={m} value={m}>
                  Milestone {m}
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
              disabled={availableTestCases.length === 0} // Disable if no test cases for selected milestone
            >
               <option value="" disabled>-- Select Test Case --</option>
              {availableTestCases.map(t => (
                <option key={t} value={t}>
                  Test Case {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Details Section - Updated to show selected M/T */}
        <div className="milestone-details">
          {selectedMilestone && selectedTestCase ? (
             <h2>Milestone {selectedMilestone} - Test Case {selectedTestCase}</h2>
          ) : selectedMilestone ? (
             <h2>Milestone {selectedMilestone} - Select Test Case</h2>
          ) : (
             <h2>Select Milestone</h2>
          )}
          <p>
            {selectedMilestone && selectedTestCase
              ? `Download the files for Milestone ${selectedMilestone}, Test Case ${selectedTestCase}, process the input, and upload your output.`
              : "Select a milestone and test case to view files."}
          </p>
        </div>

            {/* Loading/Error Display for Drive Files */}
            {isLoadingFiles && <p className="loading-message">Loading contest files from Google Drive...</p>}
            {driveError && <p className="error-message">Drive Error: {driveError}</p>}

            {/* Only show actions if files are loaded (or attempted) and M/T selected */}
            {!isLoadingFiles && selectedMilestone && selectedTestCase && (
              <>
                {/* This selectors-container seems duplicated, removing the inner one */}
                {/* <div className="selectors-container"> ... </div> */}

            <div className="milestone-details"> {/* This seems like a duplicate details section, removing */}
              {/* Content moved to the details section above */}
              {/* Display file names if found */}
              {problemStatementFile && <p>Problem Statement: <strong>{problemStatementFile.name}</strong></p>}
              {testCaseInputFile && <p>Input/Output File: <strong>{testCaseInputFile.name}</strong></p>}
              {/* Show warnings if specific files for selection are missing */}
              {!problemStatementFile && selectedMilestone && <p className="warning-message">Problem statement PDF for Milestone {selectedMilestone} not found.</p>}
              {!testCaseInputFile && selectedMilestone && selectedTestCase && <p className="warning-message">Test case CSV for M{selectedMilestone} T{selectedTestCase} not found.</p>}
            </div>

            <div className="contest-actions">
               {/* Download Problem Statement Button */}
               <button
                 className="download-button statement-button"
                 onClick={handleDownloadStatementClick}
                 disabled={isDownloadingStatement || !problemStatementFile?.id || !isSignedIn}
               >
                 {isDownloadingStatement ? 'Opening...' : 'Download Problem Statement'}
               </button>

              {/* Download Input File Button */}
              <button
                className="download-button"
                onClick={handleDownloadInputClick}
                disabled={isDownloadingInput || !testCaseInputFile?.id || !isSignedIn}
              >
                {isDownloadingInput ? 'Downloading...' : 'Download Input File'}
              </button>
          
              {/* Upload Output File Button */}
              <button
                className="upload-button"
                onClick={handleUploadClick}
                disabled={isUploading || !testCaseInputFile?.id || !isSignedIn}
              >
                {isUploading ? 'Scoring...' : 'Upload & Score Output'}
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
                {/* Show only if a file is selected, even before scoring finishes */}
                {uploadedFile && !isUploading && <span className="file-details-info">Ready for scoring.</span>}
                {isUploading && <span className="file-details-info">Processing...</span>}
              </span>
            </div>
          </div>
        )}

                 {/* Score Display */}
                 {score !== null && !isUploading && (
                     <div className="score-display">
                         <h2>Your Score:</h2>
                         <p className="score-value">{score.toFixed(2)} / 100</p>
                     </div>
                 )}
                </>
             )}
            </>
        )}
        {/* Show sign-in prompt if not signed in and GAPI is loaded */}
        {!isSignedIn && isGapiLoaded && !isAuthLoading && (
            <div className="signin-prompt">
                <p>Please sign in with Google to access contest materials.</p>
                <button onClick={handleAuthClick} className="auth-button signin-button">
                    Sign In with Google
                </button>
                {authError && <p className="error-message">Auth Error: {authError}</p>}
            </div>
        )}
        {/* Show initial loading state */}
        {isAuthLoading && <p>Initializing Google Sign-In...</p>}

      </div>
    </div>
  );
};

export default ContestPage;
