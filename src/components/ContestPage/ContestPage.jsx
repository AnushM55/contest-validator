import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'; // Import useMemo
import { gapi } from 'gapi-script'; // Import gapi-script
import Papa from 'papaparse';
import Leaderboard from '../Leaderboard/Leaderboard'; // Import Leaderboard
import './ContestPage.css';

// --- Google API Configuration ---
const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";
// --- ---

// --- Contest Configuration ---
const CONTEST_FOLDER_ID = process.env.REACT_APP_CONTEST_FOLDER_ID;
const EXPECTED_OUTPUT_COLUMN = process.env.REACT_APP_EXPECTED_OUTPUT_COLUMN; // Column name in Drive CSV
const USER_ANSWER_COLUMN = process.env.REACT_APP_USER_ANSWER_COLUMN; // Column name in User's CSV
// --- ---

// Backend API URL
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

// Filename parsing regex (adjust if convention differs)
const PROBLEM_REGEX = /Problem_M(\d+)\.pdf$/i;
// Updated regex to capture ONLY input type and handle extensions
const TESTCASE_INPUT_REGEX = /TestCase_M(\d+)_T(\d+)_input\.(csv|json|txt)$/i; // Renamed and simplified

// Helper function to find the next available test case ID
// Now uses testCaseFilesMap keys instead of allFiles
const findNextTestCaseId = (currentMilestoneScores, currentMilestoneTestCases, selectedTestCase) => {
    // currentMilestoneTestCases should be an array of test case numbers ['1', '2', ...]
    if (!selectedTestCase || !currentMilestoneTestCases || !currentMilestoneScores) {
        return null;
    }

    // Sort the available test case numbers for the current milestone
    const sortedDiscovered = [...currentMilestoneTestCases].sort((a, b) => parseInt(a) - parseInt(b));

    // Determine which test cases are unlocked based on scores
    const newlyAvailableTestCases = [];
    for (const tc of sortedDiscovered) {
        const tcNum = parseInt(tc);
        if (tcNum === 1 || (currentMilestoneScores[String(tcNum - 1)] === 100)) {
            newlyAvailableTestCases.push(tc);
        } else {
            break;
        }
    }
    const currentTestCaseIndex = newlyAvailableTestCases.indexOf(selectedTestCase);
    const hasNextTestCase = currentTestCaseIndex !== -1 && currentTestCaseIndex < newlyAvailableTestCases.length - 1;
    return hasNextTestCase ? newlyAvailableTestCases[currentTestCaseIndex + 1] : null;
};


const ContestPage = () => {
  const { id } = useParams();
  // State for selected values
  const [selectedMilestone, setSelectedMilestone] = useState(''); // Default to empty, set after fetch
  const [selectedTestCase, setSelectedTestCase] = useState(''); // Default to empty, set after fetch
  // State for available options, populated from Drive
  const [availableMilestones, setAvailableMilestones] = useState([]); // e.g., ['1', '2']
  const [availableTestCases, setAvailableTestCases] = useState([]); // Test cases for the selected milestone e.g., [{id: '1', locked: false}, ...]
  // State to hold the structured map of ONLY input test case files
  const [testCaseInputFilesMap, setTestCaseInputFilesMap] = useState({}); // Renamed state variable

  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDownloadingInput, setIsDownloadingInput] = useState(false);
  const [isDownloadingStatement, setIsDownloadingStatement] = useState(false);
  const [isUploading, setIsUploading] = useState(false); // Tracks scoring process
  const [isLoadingFiles, setIsLoadingFiles] = useState(false); // Now tracks file loading *after* sign-in
  const [driveError, setDriveError] = useState(null);
  const [problemStatementFile, setProblemStatementFile] = useState(null); // Currently selected PDF file object
  const [problemStatementFilesMap, setProblemStatementFilesMap] = useState({}); // Stores { '1': pdfFileObj, ... }
  // testCaseInputFile state is removed, derived from map instead
  const [score, setScore] = useState(null);
  const fileInputRef = useRef(null);

  // --- Google Auth State ---
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Tracks initial auth check
  const [authError, setAuthError] = useState(null);
  const [userName, setUserName] = useState('');
  const [completionStatus, setCompletionStatus] = useState({}); // Stores { milestoneId: { testCaseId: score, ... }, ... }
  const [showLeaderboard, setShowLeaderboard] = useState(false); // State to toggle leaderboard visibility
  // --- ---
  
  // Handler for Milestone dropdown change
  const handleMilestoneChange = (e) => {
    const newMilestone = e.target.value;
    setSelectedMilestone(newMilestone);
  };

  // Handler for Test Case dropdown change
  const handleTestCaseChange = (e) => {
    const newTestCase = e.target.value;
    setSelectedTestCase(newTestCase);
    // Explicitly clear score and uploaded file when test case changes
    setScore(null);
    setUploadedFile(null);
    setDriveError(null); // Also clear any previous errors
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
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
      } catch (error) {
        console.error("Error initializing GAPI client:", error);
        setAuthError(`Error initializing Google API: ${error.message || JSON.stringify(error)}`);
        setIsAuthLoading(false);
      }
    };

    const updateSigninStatus = (signedIn) => {
      setIsSignedIn(signedIn);
      setIsAuthLoading(false);
      setAuthError(null);
      if (signedIn) {
        const profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
        setUserName(profile.getName());
        setProblemStatementFile(null);
        // setTestCaseInputFile(null); // Removed state
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
        setTestCaseInputFilesMap({}); // Use renamed state variable
        fetchProgress(id);
      } else {
        setUserName('');
        setProblemStatementFile(null);
        // setTestCaseInputFile(null); // Removed state
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
        setIsLoadingFiles(false);
        setCompletionStatus({});
        setTestCaseInputFilesMap({}); // Use renamed state variable
      }
    };

    gapi.load('client:auth2', initClient);
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [id]); 

  // --- Sign-in/Sign-out Handlers ---
  const handleAuthClick = () => {
    if (!isGapiLoaded) return;
    setIsAuthLoading(true);
    gapi.auth2.getAuthInstance().signIn().catch(err => {
        console.error("Sign-in error:", err);
        setAuthError(`Sign-in failed: ${err.error || err.message || 'Unknown error'}`);
        setIsAuthLoading(false);
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
        setTestCaseInputFilesMap({}); // Use renamed state variable
        setAvailableMilestones([]);
        setAvailableTestCases([]);
        setSelectedMilestone('');
        setSelectedTestCase('');
        setProblemStatementFile(null);
        // setTestCaseInputFile(null); // Removed state
        setIsLoadingFiles(false);
        return;
      }

      setIsLoadingFiles(true);
      setDriveError(null);
      setTestCaseInputFilesMap({}); // Use renamed state variable

      try {
        let allFetchedFiles = []; // Still fetch all files initially
        let pageToken = undefined;
        do {
          const response = await gapi.client.drive.files.list({
            q: `'${CONTEST_FOLDER_ID}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink)',
            spaces: 'drive',
            pageSize: 100,
            pageToken: pageToken,
          });
          const result = response.result;
          if (result.files) {
            allFetchedFiles = allFetchedFiles.concat(result.files);
          }
          pageToken = result.nextPageToken;
        } while (pageToken);

        // --- Process fetched files into the structured map AND find PDFs ---
        const newTestCaseInputFilesMap = {}; // Renamed map variable
        const newProblemStatementFilesMap = {}; // Temporary map for PDFs
        const milestonesSet = new Set();

        allFetchedFiles.forEach(file => {
          const problemMatch = file.name?.match(PROBLEM_REGEX);
          if (problemMatch) {
            const milestoneId = problemMatch[1];
            milestonesSet.add(milestoneId);
            if (!newProblemStatementFilesMap[milestoneId]) { // Store the first matching PDF found
                 newProblemStatementFilesMap[milestoneId] = file;
            } else {
                 console.warn(`Duplicate Problem PDF found for M${milestoneId}: ${file.name}. Using the first one found.`);
            }
          }

          // Match only input files now
          const testcaseInputMatch = file.name?.match(TESTCASE_INPUT_REGEX);
          if (testcaseInputMatch) {
            const [, milestoneId, testCaseId] = testcaseInputMatch;
            milestonesSet.add(milestoneId);

            // Ensure milestone entry exists
            if (!newTestCaseInputFilesMap[milestoneId]) {
              newTestCaseInputFilesMap[milestoneId] = {};
            }

            // Store the input file directly under the test case ID
            if (newTestCaseInputFilesMap[milestoneId][testCaseId]) {
               console.warn(`Duplicate input file found for M${milestoneId} T${testCaseId}: ${file.name}. Using the first one found.`);
            } else {
               newTestCaseInputFilesMap[milestoneId][testCaseId] = file; // Store only the input file object
            }
          }
        });

        // --- Remove validation for output files ---
        // No need to check for pairs anymore

        setTestCaseInputFilesMap(newTestCaseInputFilesMap); // Store the structured map of input files
        setProblemStatementFilesMap(newProblemStatementFilesMap); // Store the found PDFs

        // --- Update available milestones ---
        const sortedMilestones = Array.from(milestonesSet).sort((a, b) => parseInt(a) - parseInt(b));
        setAvailableMilestones(sortedMilestones);

        // --- Set default selected milestone ---
        if (sortedMilestones.length > 0 && !selectedMilestone) {
          setSelectedMilestone(sortedMilestones[0]);
        } else if (sortedMilestones.length === 0) {
            setSelectedMilestone('');
            setAvailableTestCases([]);
            setSelectedTestCase('');
            setProblemStatementFile(null);
            // setTestCaseInputFile(null); // Removed state
            setDriveError("No valid milestone files (Problem_M*.pdf or TestCase_M*_T*_input/output.*) found.");
        }
      } catch (error) {
        console.error("Error fetching/parsing Google Drive files:", error);
        const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
        setDriveError(`Error fetching/parsing files: ${errorDetails}`);
        setTestCaseInputFilesMap({}); // Use renamed state variable
        setAvailableMilestones([]);
        setAvailableTestCases([]);
        setSelectedMilestone('');
        setSelectedTestCase('');
      } finally {
        setIsLoadingFiles(false);
      }
    };

    fetchAndParseFiles();
  // Depend on sign-in status. selectedMilestone is removed as dependency here,
  // because selecting a milestone shouldn't re-fetch all files, only update derived state.
  }, [isGapiLoaded, isSignedIn]);


  // --- Fetch User Progress (Memoized) ---
  const fetchProgress = useCallback(async (contestId) => {
    if (!isSignedIn || !isGapiLoaded || !API_BASE_URL || !contestId) return; 

    try {
      const token = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;
      // Add the missing '/contests/' segment to the URL path
      const response = await fetch(`${API_BASE_URL}/api/contests/${contestId}/progress`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorData = await response.json();
        // Try to parse error JSON, but fallback if it fails
        const errorText = await response.text(); // Read error response as text first
        let parsedErrorData = { error: `HTTP error! status: ${response.status}. Response: ${errorText}` }; // Renamed variable
        try {
            parsedErrorData = JSON.parse(errorText); // Try parsing if it might be JSON
        } catch (parseError) {
            console.warn("Could not parse error response as JSON:", errorText);
        }
        throw new Error(parsedErrorData.error || `HTTP error! status: ${response.status}`); // Use renamed variable
      }

      // Read response as text first for debugging
      const responseText = await response.text();
      console.log("Raw progress response:", responseText); // Log the raw text

      try {
        const progressData = JSON.parse(responseText); // Now attempt to parse
        // Adjust to access the 'progress' property from the backend response { success: true, progress: {...} }
        setCompletionStatus(progressData.progress || {});
      } catch (parseError) {
          console.error("Failed to parse progress response:", parseError, "Response text:", responseText);
          throw new Error(`Failed to parse progress data received from server. Raw response: ${responseText}`);
      }

    } catch (error) { // Catch includes fetch errors and parse errors
      console.error("Error fetching progress:", error); // Log the actual error
      setDriveError(`Failed to fetch progress: ${error.message}`);
      setCompletionStatus({});
    }
  }, [isSignedIn, isGapiLoaded, API_BASE_URL]); 

  // --- Google API Initialization and Auth Handling ---
  const updateSigninStatus = useCallback((signedIn) => {
    setIsSignedIn(signedIn);
    setIsAuthLoading(false);
    setAuthError(null);
    if (signedIn) {
      const profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
      setUserName(profile.getName());
      setProblemStatementFile(null);
      // setTestCaseInputFile(null); // Removed state
      setUploadedFile(null);
      setScore(null);
      setDriveError(null);
      if (id) fetchProgress(id); 
    } else {
      setUserName('');
      setProblemStatementFile(null);
      // setTestCaseInputFile(null); // Removed state
      setUploadedFile(null);
      setScore(null);
      setDriveError(null);
      setIsLoadingFiles(false);
      setCompletionStatus({});
    }
  }, [id, fetchProgress]); 

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
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
      } catch (error) {
        console.error("Error initializing GAPI client:", error);
        setAuthError(`Error initializing Google API: ${error.message || JSON.stringify(error)}`);
        setIsAuthLoading(false);
      }
    };
    gapi.load('client:auth2', initClient);
  }, [updateSigninStatus]); 


  // --- Effect to Update Test Cases when Milestone Changes (uses testCaseInputFilesMap) ---
  useEffect(() => {
    // Check if the selected milestone exists in our map of input files
    if (!selectedMilestone || !testCaseInputFilesMap[selectedMilestone]) {
      setAvailableTestCases([]);
      setSelectedTestCase('');
      return;
    }

    const milestoneScores = completionStatus[selectedMilestone] || {};
    // Get test case numbers available for this milestone from the input files map keys
    const discoveredTestCases = Object.keys(testCaseInputFilesMap[selectedMilestone]);

    const sortedDiscovered = discoveredTestCases.sort((a, b) => parseInt(a) - parseInt(b));

    const testCasesWithStatus = sortedDiscovered.map(tc => {
        const tcNum = parseInt(tc);
        let locked = false;
        if (tcNum > 1) {
            const prevTc = String(tcNum - 1);
            if (milestoneScores[prevTc] !== 100) locked = true;
        }
        return { id: tc, locked: locked };
    });

    setAvailableTestCases(testCasesWithStatus);

    const currentSelectionValid = testCasesWithStatus.some(tc => tc.id === selectedTestCase);
    if (!currentSelectionValid && testCasesWithStatus.length > 0) {
        const firstUnlocked = testCasesWithStatus.find(tc => !tc.locked);
        setSelectedTestCase(firstUnlocked ? firstUnlocked.id : testCasesWithStatus[0].id);
    } else if (testCasesWithStatus.length === 0) {
        setSelectedTestCase('');
        console.warn(`No discovered test cases found for Milestone ${selectedMilestone}`);
    }

    setUploadedFile(null);

  // Update dependency array: use testCaseInputFilesMap
  }, [selectedMilestone, testCaseInputFilesMap, completionStatus, selectedTestCase]);


  // --- Effect to Update Selected Problem Statement File (uses problemStatementFilesMap) ---
  useEffect(() => {
    if (!selectedMilestone) {
      setProblemStatementFile(null);
      return;
    }

    // Retrieve the PDF file object from the map based on the selected milestone
    const pdf = problemStatementFilesMap[selectedMilestone];
    setProblemStatementFile(pdf || null); // Set state, will be null if not found

    if (!pdf) {
        console.warn(`Problem PDF for M${selectedMilestone} not found in the fetched files map.`);
    }

    // Reset upload state when selection changes
    setUploadedFile(null);

  // This effect now depends on selectedMilestone and the map containing the PDFs
  }, [selectedMilestone, problemStatementFilesMap]);


  // --- Download Problem Statement (Using GAPI) ---
  const handleDownloadStatementClick = async () => {
      if (!problemStatementFile || !isSignedIn) return; 
      setIsDownloadingStatement(true);
      setDriveError(null);
      if (problemStatementFile.webViewLink) {
          window.open(problemStatementFile.webViewLink, '_blank');
      } else {
          console.warn("No webViewLink found for:", problemStatementFile.id);
          try {
                  const response = await gapi.client.drive.files.get({ fileId: problemStatementFile.id, fields: 'webViewLink' });
                  const metadata = response.result;
                  if (metadata.webViewLink) window.open(metadata.webViewLink, '_blank');
                  else setDriveError('Could not find a view link.');
              } catch (error) {
                  console.error("Error getting statement metadata:", error);
                  const errorDetails = error.result?.error?.message || error.message || 'Unknown error';
                  setDriveError(`Failed to get statement link: ${errorDetails}`);
              }
      }
      setIsDownloadingStatement(false);
  };


  // --- Download Test Case Input File (Using GAPI and Map) ---
  const handleDownloadInputClick = async () => {
    // Get the input file object from the input files map
    const inputFile = testCaseInputFilesMap[selectedMilestone]?.[selectedTestCase]; // Directly access input file

    if (!inputFile || !isSignedIn) {
        setDriveError("Input file not found for this selection or not signed in.");
        return;
    }

    setIsDownloadingInput(true);
    setDriveError(null);

    try {
        const response = await gapi.client.drive.files.get({
            fileId: inputFile.id, // Use the input file ID
            alt: 'media'
        });
        const fileContent = response.body;
        if (typeof fileContent !== 'string') throw new Error('Invalid content received.');

        let blob;
        let mimeType = 'application/octet-stream'; // Default MIME type
        const fileName = inputFile.name || `M${selectedMilestone}_T${selectedTestCase}_input`; // Use input file name
        const fileExtension = fileName.split('.').pop()?.toLowerCase();

        if (fileExtension === 'csv') {
            // CSV: Parse, filter answer column, unparse
            const parseResult = await parseCsv(fileContent);
            if (!Array.isArray(parseResult)) throw new Error('Failed to parse CSV.');
            const filteredData = parseResult.map(row => {
                const newRow = { ...row };
                // Only delete if the column name is defined and exists
                if (EXPECTED_OUTPUT_COLUMN && EXPECTED_OUTPUT_COLUMN in newRow) {
                    delete newRow[EXPECTED_OUTPUT_COLUMN];
                }
                return newRow;
            });
            const filteredCsvString = Papa.unparse(filteredData);
            mimeType = 'text/csv;charset=utf-8;';
            blob = new Blob([filteredCsvString], { type: mimeType });
        } else if (fileExtension === 'json') {
            // JSON: Download as is
            mimeType = 'application/json;charset=utf-8;';
            blob = new Blob([fileContent], { type: mimeType });
        } else if (fileExtension === 'txt') {
            // TXT: Download as is
            mimeType = 'text/plain;charset=utf-8;';
            blob = new Blob([fileContent], { type: mimeType });
        } else {
            // Other types: Download as is with default MIME type
             console.warn(`Downloading file with unknown extension '${fileExtension}' as octet-stream.`);
             blob = new Blob([fileContent], { type: mimeType });
        }

        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName; // Use the original file name
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error("Error downloading input file:", error);
        const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
        setDriveError(`Error downloading input file: ${errorDetails}`);
    } finally {
        setIsDownloadingInput(false);
    }
  };

  const handleUploadClick = () => {
    setUploadedFile(null);
    setScore(null);
    setDriveError(null);
    fileInputRef.current.value = null; 
    fileInputRef.current.click();
  };

  // Helper function to parse CSV data using PapaParse
  // Added 'parseWithHeader' option
  const parseCsv = (fileOrString, parseWithHeader = true) => {
    return new Promise((resolve, reject) => {
      Papa.parse(fileOrString, {
        header: parseWithHeader, // Use the provided option
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) console.error("CSV Parsing Errors:", results.errors);
          resolve(Array.isArray(results.data) ? results.data : []);
        },
        error: (error) => {
          console.error("PapaParse Error:", error);
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        }
      });
    });
  };

  // Removed deepEqual helper function as comparison is now backend-driven

  // Function to submit user output to backend for scoring
  const calculateScore = async (userFile) => {
      // Check if user file and selection are valid
      if (!userFile || !selectedMilestone || !selectedTestCase || !isSignedIn || !API_BASE_URL || !id) {
          setDriveError("Cannot submit: Missing user file, milestone/testcase selection, API URL, contest ID, or not signed in.");
          return;
      }

      // Check if the INPUT file exists in the map (as a proxy for valid test case selection)
      const inputFile = testCaseInputFilesMap[selectedMilestone]?.[selectedTestCase];
      if (!inputFile) {
          setDriveError(`Cannot submit: Input file details not found for M${selectedMilestone} T${selectedTestCase}.`);
          return;
      }

      setIsUploading(true);
      setScore(null);
      setDriveError(null);

      try {
          // Read user's uploaded file content
          const userFileContent = await userFile.text();

          // Get the Google ID token
          const token = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;

          // Call the backend /api/submit endpoint
          const response = await fetch(`${API_BASE_URL}/api/submit`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  contestId: id,
                  milestoneId: selectedMilestone,
                  testcaseId: selectedTestCase,
                  userOutputContent: userFileContent
                  // outputFormat is removed - backend determines this
              }),
          });

          const result = await response.json();

          if (!response.ok) {
              // Handle API errors (e.g., 400, 401, 500)
              throw new Error(result.error || `API Error: ${response.status}`);
          }

          if (result.success) {
              // Update score and progress state from the backend response
              setScore(result.score);
              setCompletionStatus(result.updatedProgress || {}); // Update progress from backend
              console.log(`Backend scoring successful for M${selectedMilestone} T${selectedTestCase}. Score: ${result.score}`);
          } else {
              // Handle cases where the API call succeeded but scoring failed logically
              throw new Error(result.error || 'Backend reported scoring failure.');
          }

      } catch (error) {
          console.error("Error submitting/scoring:", error);
          setDriveError(`Submission/Scoring Error: ${error.message}`);
          setScore(null); // Reset score on error
      } finally {
          setIsUploading(false);
      }
  };


  // Updated handleFileChange to trigger scoring and accept multiple types
  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const allowedExtensions = ['.csv', '.json', '.txt'];
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

      // Basic check for allowed extensions
      if (!allowedExtensions.includes(fileExtension)) {
         setDriveError(`Invalid file type. Please upload a CSV, JSON, or TXT file. You uploaded: ${file.name}`);
         setUploadedFile(null); // Clear any previously selected file
         fileInputRef.current.value = null; // Reset file input
         return;
      }

      setUploadedFile(file); // Set the file state immediately for UI feedback
      await calculateScore(file); // Trigger scoring process
    }
  };

  // Handler for the "Proceed to Next Test Case" button
  const handleProceedToNextTestCase = (nextId) => { // Accept nextId as argument
    if (nextId) {
      setSelectedTestCase(nextId);
      // Reset states for the new test case
      setUploadedFile(null);
      setScore(null); // Uncommented to explicitly clear score when proceeding
      setDriveError(null); // Clear previous errors
    }
  };

  // --- Calculate next test case ID for rendering using useMemo (using input map keys) ---
  const nextIdToProceed = useMemo(() => {
      if (score !== 100) return null;
      // Use keys from the input files map
      const currentMilestoneTestCases = testCaseInputFilesMap[selectedMilestone] ? Object.keys(testCaseInputFilesMap[selectedMilestone]) : [];
      if (!selectedMilestone || !selectedTestCase || currentMilestoneTestCases.length === 0 || !completionStatus[selectedMilestone]) {
          return null;
      }
      // Pass the array of test case IDs for the current milestone
      return findNextTestCaseId(completionStatus[selectedMilestone], currentMilestoneTestCases, selectedTestCase);
  }, [score, completionStatus, selectedMilestone, selectedTestCase, testCaseInputFilesMap]); // Use renamed state variable

  // Determine if the currently selected test case is locked
  const isCurrentTestCaseLocked = useMemo(() => {
    const currentTestCaseData = availableTestCases.find(tc => tc.id === selectedTestCase);
    return currentTestCaseData?.locked || false; // Default to false if not found (shouldn't happen in normal flow)
  }, [selectedTestCase, availableTestCases]);

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
              disabled={availableTestCases.length === 0} // Disable if no test cases discovered
            >
               <option value="" disabled>-- Select Test Case --</option>
              {/* Map over all discovered test cases, showing lock/check status */}
              {availableTestCases.map(tc => {
                const milestoneProgress = completionStatus ? completionStatus[selectedMilestone] : undefined;
                const testCaseScore = milestoneProgress ? milestoneProgress[tc.id] : undefined;
                const isSolved = testCaseScore === 100;
                const isLocked = tc.locked;

                return (
                  <option key={tc.id} value={tc.id} disabled={isLocked}>
                    {isLocked ? '🔒 ' : isSolved ? '✓ ' : ''}Test Case {tc.id}
                  </option>
                );
              })}
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

            {/* Removed duplicate milestone-details div */}
            {/* Display file names derived from map */}
            <div className="file-info-display">
                {problemStatementFile && <p>Problem Statement: <strong>{problemStatementFile.name}</strong></p>}
                {/* Derive input file from map for display */}
                {selectedMilestone && selectedTestCase && testCaseInputFilesMap[selectedMilestone]?.[selectedTestCase] ? (
                    <p>Input File: <strong>{testCaseInputFilesMap[selectedMilestone][selectedTestCase].name}</strong></p>
                 ) : (
                     selectedMilestone && selectedTestCase && <p className="warning-message">Input file for M{selectedMilestone} T{selectedTestCase} not found.</p>
                 )}
                 {/* Removed display for Expected Output File */}
                 {/* Show warning if problem statement PDF is missing */}
                 {!problemStatementFile && selectedMilestone && <p className="warning-message">Problem statement PDF for Milestone {selectedMilestone} not found.</p>}
            </div>

            <div className="contest-actions">
               {/* Download Problem Statement Button (remains the same) */}
               <button
                 className="download-button statement-button"
                 onClick={handleDownloadStatementClick}
                 disabled={isDownloadingStatement || !problemStatementFile?.id || !isSignedIn}
               >
                 {isDownloadingStatement ? 'Opening...' : 'Download Problem Statement'}
               </button>

              {/* Download Input File Button (disables based on input file from map AND lock status) */}
              <button
                className="download-button"
                onClick={handleDownloadInputClick}
                disabled={isCurrentTestCaseLocked || isDownloadingInput || !testCaseInputFilesMap[selectedMilestone]?.[selectedTestCase]?.id || !isSignedIn} // Added isCurrentTestCaseLocked
              >
                {isDownloadingInput ? 'Downloading...' : (isCurrentTestCaseLocked ? 'Locked' : 'Download Input File')}
              </button>

              {/* Upload Output File Button (disables based on INPUT file existence AND lock status) */}
              <button
                className="upload-button"
                onClick={handleUploadClick}
                disabled={isCurrentTestCaseLocked || isUploading || !testCaseInputFilesMap[selectedMilestone]?.[selectedTestCase]?.id || !isSignedIn} // Added isCurrentTestCaseLocked
              >
                {isUploading ? 'Scoring...' : (isCurrentTestCaseLocked ? 'Locked' : 'Upload Your Output')}
              </button>
          
              <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept=".csv,.json,.txt" // Accept multiple file types
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

                 {/* Score Display & Proceed Button */}
                 {score !== null && !isUploading && (
                     <div className="score-display">
                         <h2>Your Score:</h2>
                         <p className="score-value">{score.toFixed(2)} / 100</p>
                         {/* Calculate and render confirmation inline using useMemo result */}
                         {nextIdToProceed && (
                             <div className="proceed-confirmation">
                                 <p>Score is 100%! Ready for the next challenge?</p>
                                 <button
                                     onClick={() => handleProceedToNextTestCase(nextIdToProceed)} // Pass ID here
                                     className="proceed-button"
                                 >
                                     Proceed to Test Case {nextIdToProceed}
                                 </button>
                             </div>
                         )}
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

      {/* Leaderboard Section - Conditionally rendered */}
      {isSignedIn && isGapiLoaded && id && (
        <div className="leaderboard-toggle-section">
           <button
             onClick={() => setShowLeaderboard(!showLeaderboard)}
             className="toggle-leaderboard-button"
           >
             {showLeaderboard ? 'Hide Leaderboard' : 'Show Leaderboard'}
           </button>
           {showLeaderboard && (
             <div className="leaderboard-section">
               <Leaderboard
                 contestId={id}
                 userToken={gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token}
               />
             </div>
           )}
        </div>
      )}
    </div> // This is the correct closing tag for contest-container
  );
};

export default ContestPage;
