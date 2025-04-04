import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback } from 'react'; // Import useCallback
import { gapi } from 'gapi-script'; // Import gapi-script
import Papa from 'papaparse';
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
  const [completionStatus, setCompletionStatus] = useState({}); // Stores { milestoneId: [completedTestCaseId, ...], ... }
  // --- ---
  
  // Remove hardcoded lists
  // const milestones = ['1', '2', '3'];
  // const testCases = ['1', '2', '3', '4', '5'];
  
  // Handler for Milestone dropdown change
  const handleMilestoneChange = (e) => {
    const newMilestone = e.target.value;
    setSelectedMilestone(newMilestone);
    // Test cases and selected files will be updated by the useEffect hooks
    // Resetting selected test case here might cause a brief inconsistent state,
    // the useEffect hook depending on selectedMilestone handles it.
  };

  // Handler for Test Case dropdown change
  const handleTestCaseChange = (e) => {
    const newTestCase = e.target.value;
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
        // Get user profile information
        const profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
        setUserName(profile.getName());
        // Clear file/score state from previous sessions/users
        setProblemStatementFile(null);
        setTestCaseInputFile(null);
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
        // Fetch progress when user signs in
        fetchProgress(id); 
      } else {
        setUserName('');
        // Clear data when user signs out
        setProblemStatementFile(null);
        setTestCaseInputFile(null);
        setUploadedFile(null);
        setScore(null);
        setDriveError(null);
        setIsLoadingFiles(false); // Stop file loading if user signs out
        setCompletionStatus({}); // Clear progress on sign out
      }
    };

    // Load the GAPI client and auth2 module
    gapi.load('client:auth2', initClient);
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [id]); // Add id as dependency (fetchProgress depends on it indirectly via updateSigninStatus)
  // Note: fetchProgress and updateSigninStatus are defined inside useEffect or are stable, 
  // but adding id covers the case where the component might remount with a different id.
  // If fetchProgress were defined outside and not memoized, it would also need to be added.

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
  }, [isGapiLoaded, isSignedIn]); // Dependency: only run when auth state changes


  // --- Fetch User Progress (Memoized) ---
  // Define fetchProgress outside the useEffect that calls it
  const fetchProgress = useCallback(async (contestId) => {
    // Check dependencies directly inside useCallback
    // Ensure contestId is valid before proceeding
    if (!isSignedIn || !isGapiLoaded || !API_BASE_URL || !contestId) return; 

    try {
      const token = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;
      const response = await fetch(`${API_BASE_URL}/api/progress/${contestId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const progressData = await response.json();
      setCompletionStatus(progressData || {}); // Ensure it's an object
    } catch (error) {
      console.error("Error fetching progress:", error);
      setDriveError(`Failed to fetch progress: ${error.message}`); // Use driveError state for simplicity
      setCompletionStatus({}); // Reset progress on error
    }
  // Add dependencies for useCallback
  }, [isSignedIn, isGapiLoaded, API_BASE_URL]); 

  // --- Google API Initialization and Auth Handling ---
  // Define updateSigninStatus outside useEffect, memoize with useCallback
  const updateSigninStatus = useCallback((signedIn) => {
    setIsSignedIn(signedIn);
    setIsAuthLoading(false); // Initial auth check complete
    setAuthError(null); // Clear previous auth errors on status change
    if (signedIn) {
      // Get user profile information
      const profile = gapi.auth2.getAuthInstance().currentUser.get().getBasicProfile();
      setUserName(profile.getName());
      // Clear file/score state from previous sessions/users
      setProblemStatementFile(null);
      setTestCaseInputFile(null);
      setUploadedFile(null);
      setScore(null);
      setDriveError(null);
      // Fetch progress when user signs in - use the id from component scope
      if (id) { // Ensure id is available
        fetchProgress(id); 
      }
    } else {
      setUserName('');
      // Clear data when user signs out
      setProblemStatementFile(null);
      setTestCaseInputFile(null);
      setUploadedFile(null);
      setScore(null);
      setDriveError(null);
      setIsLoadingFiles(false); // Stop file loading if user signs out
      setCompletionStatus({}); // Clear progress on sign out
    }
  // Dependencies for updateSigninStatus
  }, [id, fetchProgress, setUserName, setIsSignedIn, setIsAuthLoading, setAuthError, setProblemStatementFile, setTestCaseInputFile, setUploadedFile, setScore, setDriveError, setIsLoadingFiles, setCompletionStatus]); 

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

    // Load the GAPI client and auth2 module
    gapi.load('client:auth2', initClient);
  // Add updateSigninStatus (now stable) to dependency array
  }, [updateSigninStatus]); 


  // --- Effect to Update Test Cases when Milestone Changes (incorporates progress) ---
  useEffect(() => {
    if (!selectedMilestone || allFiles.length === 0) {
      setAvailableTestCases([]);
      setSelectedTestCase('');
      return;
    }

    // Get the scores for the current milestone, default to empty object
    const milestoneScores = completionStatus[selectedMilestone] || {}; 
    const discoveredTestCases = new Set();
    allFiles.forEach(file => {
      const match = file.name?.match(TESTCASE_REGEX);
      if (match && match[1] === selectedMilestone) {
        discoveredTestCases.add(match[2]); // Add the test case number
      }
    });

    const sortedDiscovered = Array.from(discoveredTestCases).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Determine which test cases are actually available based on 100% score on previous
    const unlockedTestCases = [];
    for (const tc of sortedDiscovered) {
        const tcNum = parseInt(tc);
        // Test case 1 is always available if discovered
        if (tcNum === 1) {
            unlockedTestCases.push(tc);
        } else {
            // Check if the previous test case exists and has a score of 100
            const prevTc = String(tcNum - 1);
            if (milestoneScores[prevTc] === 100) {
                unlockedTestCases.push(tc);
            } else {
                // If previous test case wasn't passed with 100%, stop unlocking further test cases
                break; 
            }
        }
    }

    setAvailableTestCases(unlockedTestCases);

    // Select the first *unlocked* test case, or clear selection if none are available/unlocked
    if (unlockedTestCases.length > 0) {
        // If the previously selected test case is still unlocked, keep it. Otherwise, select the first unlocked.
        if (!unlockedTestCases.includes(selectedTestCase)) {
             setSelectedTestCase(unlockedTestCases[0]);
        }
    } else {
      setSelectedTestCase('');
      console.warn(`No available/unlocked test cases found for Milestone ${selectedMilestone}`);
    }
    // Reset upload state when milestone changes
    setUploadedFile(null);
    // setScore(null); // Remove score reset here

  }, [selectedMilestone, allFiles, completionStatus, selectedTestCase]); // Keep selectedTestCase here


  // --- Effect to Update Selected Files based on M/T selection ---
  useEffect(() => {
    if (!selectedMilestone || !selectedTestCase || allFiles.length === 0) {
      setProblemStatementFile(null);
      setTestCaseInputFile(null);
      return;
    }

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

     // Reset upload state when test case changes
     setUploadedFile(null);
     // setScore(null); // Remove score reset here

  }, [selectedMilestone, selectedTestCase, allFiles]); // Re-run when selection or files change


  // --- Download Problem Statement (Using GAPI) ---
  const handleDownloadStatementClick = async () => {
      if (!problemStatementFile || !isSignedIn) return; // Need to be signed in

      setIsDownloadingStatement(true);
      setDriveError(null);

      // Simplest approach: Open the webViewLink which should always be available
      // Direct download via webContentLink or fetch requires more complex token handling/CORS
      if (problemStatementFile.webViewLink) {
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

    try {
        // Use gapi.client.drive.files.get with alt=media
        const response = await gapi.client.drive.files.get({
            fileId: testCaseInputFile.id,
            alt: 'media'
        });

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


  // Function to calculate score (Using GAPI for expected output) & Record Completion
  const calculateScore = async (userFile) => {
      if (!userFile || !testCaseInputFile || !isSignedIn) {
          setDriveError("Missing user file, test case file information, or not signed in.");
          return;
      }

      setIsUploading(true); // Use isUploading state to indicate scoring process
      setScore(null);
      setDriveError(null);

      try {
          // 1. Fetch expected data from Google Drive using GAPI
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

          // 3. Parse both CSVs
          const [expectedData, userData] = await Promise.all([
              parseCsv(expectedCsvString),
              parseCsv(userCsvString)
          ]);


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
          setScore(calculatedScore);

          // Declare updatedProgress here to make it accessible later
          let updatedProgress = null; 

          // --- Record Score (Always) ---
          try {
            const token = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;
            const completionResponse = await fetch(`${API_BASE_URL}/api/completion`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  contestId: id,
                  milestoneId: selectedMilestone,
                  testcaseId: selectedTestCase,
                  score: calculatedScore // Add the score here
                }),
              });

              if (!completionResponse.ok) {
                const errorData = await completionResponse.json();
                throw new Error(errorData.error || `Failed to record completion (HTTP ${completionResponse.status})`);
              }
              
              const result = await completionResponse.json();
              // Assign the result to the higher-scoped variable
              updatedProgress = result.updatedProgress || {}; 
              // Update local progress state immediately
              setCompletionStatus(updatedProgress);

              // --- Ask user to advance to next test case ---

              // Find the next available test case *before* asking
              const currentMilestoneScores = updatedProgress[selectedMilestone] || {};
                const discoveredTestCases = new Set();
                allFiles.forEach(file => {
                  const match = file.name?.match(TESTCASE_REGEX);
                  if (match && match[1] === selectedMilestone) {
                      discoveredTestCases.add(match[2]);
                  }
              });
              const sortedDiscovered = Array.from(discoveredTestCases).sort((a, b) => parseInt(a) - parseInt(b));
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
              const nextTestCase = hasNextTestCase ? newlyAvailableTestCases[currentTestCaseIndex + 1] : null;

              // Ask for confirmation only if there is a next test case
              if (hasNextTestCase && nextTestCase) {
                  const proceed = window.confirm(`Score is 100! Proceed to Test Case ${nextTestCase}?`);
                  if (proceed) {
                      setSelectedTestCase(nextTestCase); // Update state to trigger UI change
                      // Reset upload state for the new test case
                      setUploadedFile(null);
                      setScore(null); // Reset score *after* advancing
                  } else {
                      // Stay on the current test case, keep score displayed
                  }
              } else {
                   // Stay on the current test case, keep score displayed
              }
              // --- End Ask user to advance ---

            } catch (completionError) {
              // This is the catch block for the fetch /api/completion call
              console.error("Error recording completion:", completionError);
              // Display error, but don't overwrite scoring error if one exists
              setDriveError(prev => prev ? `${prev}\nFailed to record completion: ${completionError.message}` : `Failed to record completion: ${completionError.message}`);
            } // End of try...catch for recording score

            // --- Ask user to advance ONLY if Score is 100% and recording was successful ---
            if (calculatedScore === 100 && updatedProgress) { // Check if updatedProgress has a value
                // Find the next available test case *using the updatedProgress*
                const currentMilestoneScores = updatedProgress[selectedMilestone] || {};
                const discoveredTestCases = new Set();
                allFiles.forEach(file => {
                    const match = file.name?.match(TESTCASE_REGEX);
                    if (match && match[1] === selectedMilestone) {
                        discoveredTestCases.add(match[2]);
                    }
                });
                const sortedDiscovered = Array.from(discoveredTestCases).sort((a, b) => parseInt(a) - parseInt(b));
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
                const nextTestCase = hasNextTestCase ? newlyAvailableTestCases[currentTestCaseIndex + 1] : null;

                // Ask for confirmation only if there is a next test case
                if (hasNextTestCase && nextTestCase) {
                    const proceed = window.confirm(`Score is 100! Proceed to Test Case ${nextTestCase}?`);
                    if (proceed) {
                        setSelectedTestCase(nextTestCase); // Update state to trigger UI change
                        // Reset upload state for the new test case
                        setUploadedFile(null);
                        setScore(null); // Reset score *after* advancing
                    } else {
                        // Stay on the current test case, keep score displayed
                    }
                } else {
                    // Stay on the current test case, keep score displayed
                }
            } // End of if (calculatedScore === 100) for advancing logic
            // --- End Ask user to advance ---

          } catch (error) { // This catch is now for the outer try block (scoring calculation)
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
              disabled={availableTestCases.length === 0} // Disable if no test cases available/unlocked
            >
               <option value="" disabled>-- Select Test Case --</option>
              {/* Map over available (unlocked) test cases and add checkmark if solved */}
              {availableTestCases.map(t => {
                // Explicitly check if the score for this milestone/testcase is exactly 100
                // If a checkmark appears unexpectedly, it means completionStatus contains this score
                const milestoneProgress = completionStatus ? completionStatus[selectedMilestone] : undefined;
                const testCaseScore = milestoneProgress ? milestoneProgress[t] : undefined;
                const isSolved = testCaseScore === 100;
                // console.log(`Checkmark debug: M=${selectedMilestone}, T=${t}, Score=${testCaseScore}, isSolved=${isSolved}`); // Keep for debugging if needed
                return (
                  <option key={t} value={t}>
                    {isSolved ? '✓ ' : ''}Test Case {t}
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
            {/* Display file names if found */}
            <div className="file-info-display"> {/* Optional: Wrap file info */}
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
