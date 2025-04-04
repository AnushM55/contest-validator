import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'; // Import useMemo
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
// Updated regex to capture input/output type and handle extensions
const TESTCASE_REGEX = /TestCase_M(\d+)_T(\d+)_(input|output)\.(csv|json|txt)$/i;

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
  // State to hold the structured map of test case files
  const [testCaseFilesMap, setTestCaseFilesMap] = useState({}); // e.g., { '1': { '1': { input: file, output: file }, ... }, ... }

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
        setTestCaseFilesMap({}); // Clear the map on sign in before fetch
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
        setTestCaseFilesMap({}); // Clear the map on sign out
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
        setTestCaseFilesMap({}); // Clear map
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
      setTestCaseFilesMap({}); // Clear previous map

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
        const newTestCaseFilesMap = {};
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

          const testcaseMatch = file.name?.match(TESTCASE_REGEX);
          if (testcaseMatch) {
            const [, milestoneId, testCaseId, type] = testcaseMatch; // type is 'input' or 'output'
            milestonesSet.add(milestoneId);

            // Ensure milestone and test case entries exist
            if (!newTestCaseFilesMap[milestoneId]) {
              newTestCaseFilesMap[milestoneId] = {};
            }
            if (!newTestCaseFilesMap[milestoneId][testCaseId]) {
              newTestCaseFilesMap[milestoneId][testCaseId] = { input: null, output: null };
            }

            // Add the file to the correct slot (input/output)
            if (type === 'input') {
              if (newTestCaseFilesMap[milestoneId][testCaseId].input) {
                 console.warn(`Duplicate input file found for M${milestoneId} T${testCaseId}: ${file.name}. Using the first one found.`);
              } else {
                 newTestCaseFilesMap[milestoneId][testCaseId].input = file;
              }
            } else if (type === 'output') {
               if (newTestCaseFilesMap[milestoneId][testCaseId].output) {
                 console.warn(`Duplicate output file found for M${milestoneId} T${testCaseId}: ${file.name}. Using the first one found.`);
               } else {
                 newTestCaseFilesMap[milestoneId][testCaseId].output = file;
               }
            }
          }
        });

        // --- Validate the map: Ensure each test case has both input and output ---
        Object.keys(newTestCaseFilesMap).forEach(mId => {
            Object.keys(newTestCaseFilesMap[mId]).forEach(tId => {
                const pair = newTestCaseFilesMap[mId][tId];
                if (!pair.input || !pair.output) {
                    console.warn(`Incomplete file pair for M${mId} T${tId}. Input: ${pair.input?.name}, Output: ${pair.output?.name}. This test case might not work correctly.`);
                    // Optionally remove incomplete pairs: delete newTestCaseFilesMap[mId][tId];
                }
            });
             // Optionally remove milestones with no complete pairs
            // if (Object.keys(newTestCaseFilesMap[mId]).length === 0) {
            //     delete newTestCaseFilesMap[mId];
            //     milestonesSet.delete(mId);
            // }
        });

        setTestCaseFilesMap(newTestCaseFilesMap); // Store the structured map
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
        setTestCaseFilesMap({}); // Clear map on error
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
      const response = await fetch(`${API_BASE_URL}/api/progress/${contestId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const progressData = await response.json();
      setCompletionStatus(progressData || {});
    } catch (error) {
      console.error("Error fetching progress:", error);
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


  // --- Effect to Update Test Cases when Milestone Changes (uses testCaseFilesMap) ---
  useEffect(() => {
    // Check if the selected milestone exists in our map
    if (!selectedMilestone || !testCaseFilesMap[selectedMilestone]) {
      setAvailableTestCases([]);
      setSelectedTestCase('');
      return;
    }

    const milestoneScores = completionStatus[selectedMilestone] || {};
    // Get test case numbers available for this milestone from the map keys
    const discoveredTestCases = Object.keys(testCaseFilesMap[selectedMilestone]);

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

  // Update dependency array: use testCaseFilesMap instead of allFiles
  }, [selectedMilestone, testCaseFilesMap, completionStatus, selectedTestCase]);


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
    // Get the input file object from the map
    const currentFiles = testCaseFilesMap[selectedMilestone]?.[selectedTestCase];
    const inputFile = currentFiles?.input;

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

  // Helper function for deep equality check (for JSON comparison)
  const deepEqual = (obj1, obj2) => {
    if (obj1 === obj2) return true;

    if (obj1 === null || typeof obj1 !== "object" || obj2 === null || typeof obj2 !== "object") {
      return false;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
        return false;
      }
    }
    return true;
  };


  // Function to calculate score (Handles CSV, JSON, TXT using Map) & Record Completion
  const calculateScore = async (userFile) => {
      // Get the OUTPUT file object from the map
      const currentFiles = testCaseFilesMap[selectedMilestone]?.[selectedTestCase];
      const expectedOutputFile = currentFiles?.output;

      if (!userFile || !expectedOutputFile || !isSignedIn) {
          setDriveError("User file, expected output file not found for this selection, or not signed in.");
          return;
      }

      setIsUploading(true);
      setScore(null);
      setDriveError(null);
      try {
          // Fetch expected OUTPUT data from Google Drive
          const driveResponse = await gapi.client.drive.files.get({ fileId: expectedOutputFile.id, alt: 'media' });
          const expectedFileContent = driveResponse.body;
          if (typeof expectedFileContent !== 'string') throw new Error('Invalid expected output content received.');

          // Read user's uploaded file
          const userFileContent = await userFile.text();

          // Determine file type from the expected OUTPUT file's name
          const fileName = expectedOutputFile.name || '';
          const fileExtension = fileName.split('.').pop()?.toLowerCase();

          let calculatedScore = 0; // Default score

          switch (fileExtension) {
              case 'csv':
                  // --- CSV Comparison ---
                  // Always parse with headers and compare based on headers

                  const [expectedData, userData] = await Promise.all([
                      parseCsv(expectedFileContent, true), // Always parse with header: true
                      parseCsv(userFileContent, true)      // Always parse with header: true
                  ]);

                  // PapaParse with header:true returns an array of objects
                  if (!Array.isArray(expectedData) || !Array.isArray(userData)) throw new Error("Parsed CSV data is not in array format.");
                  if (expectedData.length === 0) throw new Error("Expected CSV output file is empty or could not be parsed.");
                  if (userData.length === 0) throw new Error("Your uploaded CSV file is empty or could not be parsed.");

                  // Warn about row mismatch but proceed
                  if (userData.length !== expectedData.length) {
                      console.warn(`CSV Row count mismatch: Expected ${expectedData.length}, User ${userData.length}. Scoring based on common rows.`);
                  }

                  let correctMatches = 0;
                  const comparisonLength = Math.min(userData.length, expectedData.length);

                  for (let i = 0; i < comparisonLength; i++) {
                      // Compare row objects based on expected headers (parsed with headers)
                      const userRowObj = userData[i];
                      const expectedRowObj = expectedData[i];

                          // Ensure both are valid objects
                          if (typeof userRowObj !== 'object' || userRowObj === null || typeof expectedRowObj !== 'object' || expectedRowObj === null) {
                              console.warn(`Row ${i+1} skipped: Invalid row data structure.`);
                              continue; // Skip this row
                          }

                          // Get headers from the first expected row (assume consistent headers)
                          const expectedHeaders = expectedData.length > 0 ? Object.keys(expectedData[0]) : [];
                          if (expectedHeaders.length === 0) {
                               console.warn(`Row ${i+1} skipped: Cannot determine expected headers.`);
                               continue; // Skip if no headers
                          }

                          let rowMatch = true;
                          // Check if user row has the same headers and compare values
                          if (Object.keys(userRowObj).length !== expectedHeaders.length) {
                              rowMatch = false; // Different number of columns
                          } else {
                              for (const header of expectedHeaders) {
                                  if (!userRowObj.hasOwnProperty(header)) {
                                      rowMatch = false; // User row missing an expected header
                                      break;
                                  }
                                  const userCell = String(userRowObj[header] ?? '').trim();
                                  const expectedCell = String(expectedRowObj[header] ?? '').trim();
                                  if (userCell !== expectedCell) {
                                      rowMatch = false;
                                      // Optional: Log specific cell mismatch
                                      // console.log(`Row ${i+1}, Header '${header}': Expected '${expectedCell}', Got '${userCell}'`);
                                      break; // No need to check further cells in this row
                                  }
                              }
                          }

                          if (rowMatch) {
                              correctMatches++;
                          } else {
                               // Optional: Log row mismatch details
                               // console.log(`Row ${i+1} mismatch: Expected ${JSON.stringify(expectedRowObj)}, Got ${JSON.stringify(userRowObj)}`);
                          }
                      // Removed the outer if/else based on compareSpecificColumns
                      // Removed extra brace here
                  }
                  // Score based on expected length
                  calculatedScore = expectedData.length > 0 ? (correctMatches / expectedData.length) * 100 : 0;
                  break;

              case 'json':
                  // --- JSON Comparison ---
                  try {
                      const expectedJson = JSON.parse(expectedFileContent);
                      const userJson = JSON.parse(userFileContent);
                      if (deepEqual(expectedJson, userJson)) {
                          calculatedScore = 100;
                      } else {
                          calculatedScore = 0;
                          console.log("JSON Comparison Failed: Objects are not deeply equal.");
                          // Optional: Log differences for debugging (can be complex)
                      }
                  } catch (jsonError) {
                      throw new Error(`Failed to parse JSON: ${jsonError.message}`);
                  }
                  break;

              case 'txt':
                  // --- TXT Comparison ---
                  // Trim whitespace from both ends of the entire content for comparison
                  if (userFileContent.trim() === expectedFileContent.trim()) {
                      calculatedScore = 100;
                  } else {
                      calculatedScore = 0;
                      console.log("TXT Comparison Failed: Content does not match.");
                  }
                  break;

              default:
                  throw new Error(`Unsupported file type for scoring: .${fileExtension}`);
          }

          setScore(calculatedScore);

          // --- Record Score (Always) ---
          let updatedProgress = null;
          try {
            const token = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;
            const completionResponse = await fetch(`${API_BASE_URL}/api/completion`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contestId: id, milestoneId: selectedMilestone, testcaseId: selectedTestCase, score: calculatedScore }),
              });
              if (!completionResponse.ok) {
                const errorData = await completionResponse.json();
                throw new Error(errorData.error || `Failed to record completion (HTTP ${completionResponse.status})`);
              }
              const result = await completionResponse.json();
              updatedProgress = result.updatedProgress || {}; 
              setCompletionStatus(updatedProgress);
            } catch (completionError) {
              console.error("Error recording completion:", completionError);
              setDriveError(prev => prev ? `${prev}\nFailed to record completion: ${completionError.message}` : `Failed to record completion: ${completionError.message}`);
            } 
      } catch (error) { 
          console.error("Error during scoring:", error);
          const errorDetails = error.result?.error?.message || error.message || 'An unknown error occurred.';
          setDriveError(`Scoring Error: ${errorDetails}`);
          setScore(null); 
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
      // setScore(null); // Let score naturally update/clear based on new context
      setDriveError(null); // Clear previous errors
    }
  };

  // --- Calculate next test case ID for rendering using useMemo (using map keys) ---
  const nextIdToProceed = useMemo(() => {
      if (score !== 100) return null;
      const currentMilestoneTestCases = testCaseFilesMap[selectedMilestone] ? Object.keys(testCaseFilesMap[selectedMilestone]) : [];
      if (!selectedMilestone || !selectedTestCase || currentMilestoneTestCases.length === 0 || !completionStatus[selectedMilestone]) {
          return null;
      }
      // Pass the array of test case IDs for the current milestone
      return findNextTestCaseId(completionStatus[selectedMilestone], currentMilestoneTestCases, selectedTestCase);
  }, [score, completionStatus, selectedMilestone, selectedTestCase, testCaseFilesMap]); // Dependencies for the calculation

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
                {/* Derive input/output files from map for display */}
                {selectedMilestone && selectedTestCase && testCaseFilesMap[selectedMilestone]?.[selectedTestCase] ? (
                    <>
                        {testCaseFilesMap[selectedMilestone][selectedTestCase].input ? (
                             <p>Input File: <strong>{testCaseFilesMap[selectedMilestone][selectedTestCase].input.name}</strong></p>
                        ) : (
                             <p className="warning-message">Input file for M{selectedMilestone} T{selectedTestCase} not found.</p>
                        )}
                         {testCaseFilesMap[selectedMilestone][selectedTestCase].output ? (
                             <p>Expected Output File: <strong>{testCaseFilesMap[selectedMilestone][selectedTestCase].output.name}</strong></p>
                         ) : (
                             <p className="warning-message">Output file for M{selectedMilestone} T{selectedTestCase} not found.</p>
                         )}
                    </>
                ) : (
                     selectedMilestone && selectedTestCase && <p className="warning-message">Test case files for M{selectedMilestone} T{selectedTestCase} not found in map.</p>
                )}
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

              {/* Download Input File Button (disables based on input file from map) */}
              <button
                className="download-button"
                onClick={handleDownloadInputClick}
                disabled={isDownloadingInput || !testCaseFilesMap[selectedMilestone]?.[selectedTestCase]?.input?.id || !isSignedIn}
              >
                {isDownloadingInput ? 'Downloading...' : 'Download Input File'}
              </button>

              {/* Upload Output File Button (disables based on output file from map, as scoring needs it) */}
              <button
                className="upload-button"
                onClick={handleUploadClick}
                disabled={isUploading || !testCaseFilesMap[selectedMilestone]?.[selectedTestCase]?.output?.id || !isSignedIn}
              >
                {isUploading ? 'Scoring...' : 'Upload Your Output'}
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
    </div>
  );
};

export default ContestPage;
