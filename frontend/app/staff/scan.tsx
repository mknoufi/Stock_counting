// cspell:words pricetag barcodes prioritise
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, ScrollView, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Switch } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView as ExpoCameraView, useCameraPermissions } from 'expo-camera';
import api, { createCountLine, checkItemCounted, getVarianceReasons, refreshItemStock, searchItems, addQuantityToCountLine, getSession, getItemByBarcode } from '@/services/api';
import { StatusBar } from 'expo-status-bar';
import { handleErrorWithRecovery } from '@/services/errorRecovery';
import { AnalyticsService, RecentItemsService } from '@/services/enhancedFeatures';
import { SearchResult } from '@/services/enhancedSearchService';
import { ErrorHandler } from '@/services/errorHandler';
import { ItemVerificationAPI } from '@/services/itemVerificationApi';
import { useAuthStore } from '@/store/authStore';
import { PremiumTheme } from '../../theme/designSystem';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  ItemSearch,
  ItemDisplay,
  QuantityInputForm,
  BarcodeScanner,
  SerialNumberEntry,
  PhotoCapture,
  CameraView,
  ResultOverlay,
  LocationInput
} from '@/components/scan';
import { useScanState } from '@/hooks/scan/useScanState';
import { usePhotoState } from '@/hooks/scan/usePhotoState';
import { useItemState } from '@/hooks/scan/useItemState';
import { useWorkflowState } from '@/hooks/scan/useWorkflowState';
import { useForm } from 'react-hook-form';
import { styles } from '@/styles/scanStyles';
import {
  Item,
  SerialInput,
  ScannerMode,
  PhotoProofType,
  VarianceReason,
  ScanFormData,
  CreateCountLinePayload,
  ApiErrorResponse
} from '@/types/scan';
import {
  normalizeSerialValue,
  toNumericMrp,
  formatMrpValue,
  getNormalizedMrpVariants,
  getDefaultMrpForItem,
  SERIAL_REQUIREMENT_LABELS,
  ITEM_CONDITION_OPTIONS
} from '@/utils/scanUtils';

const MRP_MATCH_TOLERANCE = 0.01;



export default function ScanScreen() {
  const { sessionId: rawSessionId } = useLocalSearchParams();
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [permission, requestPermission] = useCameraPermissions();
  const isWeb = Platform.OS === 'web';

  // Power-saving hook with scan-optimized configuration (stub implementation)
  // Power-saving state stub removed (unused)
  const resetActivityTimer = React.useCallback(() => {
    // Stub: Activity timer reset (power saving feature)
  }, []);
  const throttleNetworkRequest = React.useCallback((_key: string, _delay: number) => {
    // Stub: Network request throttling (power saving feature)
  }, []);

  // Use extracted hooks for state management
  const { scannerState, updateScannerState } = useScanState();
  const { photoState, updatePhotoState } = usePhotoState();

  const photoCameraRef = React.useRef<ExpoCameraView | null>(null);
  const barcodeScanHistoryRef = React.useRef<Map<string, number[]>>(new Map());

  React.useEffect(() => {
    if (!isWeb) {
      return;
    }

    if (scannerState.showScanner) {
      updateScannerState({ showScanner: false });
    }

    if (photoState.showPhotoCapture) {
      updatePhotoState({ showPhotoCapture: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeb, scannerState.showScanner, photoState.showPhotoCapture]);
  const SCAN_RATE_LIMIT = 5;
  const SCAN_RATE_WINDOW_MS = 15000;
  const registerScanAndCheckRateLimit = React.useCallback(
    (barcode: string, timestamp: number) => {
      const history = barcodeScanHistoryRef.current.get(barcode) ?? [];
      const recent = history.filter((entry) => timestamp - entry < SCAN_RATE_WINDOW_MS);
      recent.push(timestamp);
      barcodeScanHistoryRef.current.set(barcode, recent);
      return recent.length > SCAN_RATE_LIMIT;
    },
    [SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS]
  );

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Consolidated search state
  const [searchState, setSearchState] = React.useState({
    allItems: [] as Item[],
    searchResults: [] as Item[],
    showSearchResults: false,
    isSearching: false,
    isListening: false,
    voiceSearchText: '',
  });

  // Use extracted hooks for state management
  const { itemState, updateItemState } = useItemState();

  // Helper function for search state updates
  const updateSearchState = React.useCallback((updates: Partial<typeof searchState>) => {
    setSearchState(prev => ({ ...prev, ...updates }));
  }, []);

  // Consolidated UI state
  const [uiState, setUiState] = React.useState({
    showReasonModal: false,
    saving: false,
    showUnknownItemModal: false,
    unknownItemData: { barcode: '', description: '' },
    refreshingStock: false,
    sessionActive: false,
    showOptionalFields: false,
    scanFeedback: '',
    parsedMrpValue: null as number | null,
    continuousScanMode: false,
    showScanner: false,
    scannerMode: 'item' as ScannerMode,
    manualBarcode: '',
    manualItemName: '',
    searchQuery: '',
    searchResults: [] as SearchResult[],
    showSearchResults: false,
    isSearching: false,
    selectedPhotoType: 'ITEM' as PhotoProofType,
  });

  // Use extracted hook for workflow state
  const { workflowState, updateWorkflowState, addSerialInput } = useWorkflowState();

  const { control, handleSubmit, setValue, reset, watch, formState: { errors } } = useForm<ScanFormData>({
    defaultValues: {
      countedQty: '',
      returnableDamageQty: '',
      nonReturnableDamageQty: '',
      mrp: '',
      remark: '',
      varianceNote: '',
    }
  });

  // Watch values for calculations
  const watchedCountedQty = watch('countedQty');
  const watchedReturnableDamageQty = watch('returnableDamageQty');
  const watchedNonReturnableDamageQty = watch('nonReturnableDamageQty');
  const watchedMrp = watch('mrp');

  // Sync form values with itemState for backward compatibility during refactor
  React.useEffect(() => {
    updateItemState({
      countedQty: watchedCountedQty || '',
      returnableDamageQty: watchedReturnableDamageQty || '',
      nonReturnableDamageQty: watchedNonReturnableDamageQty || '',
      countedMrp: watchedMrp || '',
    });
  }, [watchedCountedQty, watchedReturnableDamageQty, watchedNonReturnableDamageQty, watchedMrp, updateItemState]);

  // Helper functions for additional state updates
  const updateUiState = React.useCallback((updates: Partial<typeof uiState>) => {
    setUiState(prev => ({ ...prev, ...updates }));
  }, []);
  // const [markLocation, setMarkLocation] = React.useState('');
  // const [sessionActive, setSessionActive] = React.React.useState(false);

  // Enhanced UI States (trimmed unused local states)


  // Duplicate scan handling
  // const [existingCountLine, setExistingCountLine] = React.useState<any>(null);
  // const [showAddQuantityModal, setShowAddQuantityModal] = React.useState(false);
  // const [additionalQty, setAdditionalQty] = React.useState('');

  // Additional Item Information Fields
  // const [srNo, setSrNo] = React.useState('');
  // const [manufacturingDate, setManufacturingDate] = React.useState('');
  const [showManufacturingDatePicker, setShowManufacturingDatePicker] = React.useState(false);
  // const [showOptionalFields, setShowOptionalFields] = React.useState(false);

  React.useEffect(() => {
    if (sessionId) {
      getSession(sessionId).then((session) => {
        if (session && session.warehouse) {
          // Parse "Floor - Rack"
          const parts = session.warehouse.split(' - ');
          if (parts.length >= 2) {
            updateItemState({
              floorNo: parts[0],
              rackNo: parts[1]
            });
          } else {
            // Fallback if not in "Floor - Rack" format
            updateItemState({ floorNo: session.warehouse });
          }
          // Auto-activate session if we have details
          updateUiState({ sessionActive: true });
        }
      }).catch(err => console.error("Failed to load session", err));
    }
  }, [sessionId]);

  const prepareItemForCounting = React.useCallback((item: Item) => {
    // Reset form values
    reset({
      countedQty: '',
      returnableDamageQty: '',
      nonReturnableDamageQty: '',
      mrp: '',
      remark: '',
      varianceNote: '',
    });

    updateItemState({
      currentItem: item,
      countedQty: '',
      selectedReason: '',
      countedMrp: getDefaultMrpForItem(item),
      varianceNote: '',
      remark: '',
      itemCondition: 'good',
      conditionManuallySet: false,
      selectedVariant: null,
      returnableDamageQty: '',
      nonReturnableDamageQty: '',
    });
    updateScannerState({ serialScanTargetId: null });
    updatePhotoState({
      photoProofs: [],
      selectedPhotoType: 'ITEM',
    });
    updateUiState({ showReasonModal: false });
    updateWorkflowState({
      serialCaptureEnabled: false,
      serialInputs: [],
    });

    // Reset warehouse location fields
    // Floor and Rack are now session-level and should persist
    updateItemState({
      markLocation: '',
      srNo: '',
      manufacturingDate: ''
    });
    updateUiState({ showOptionalFields: false });
  }, []);

  // Update parsedMrpValue in uiState
  React.useEffect(() => {
    const trimmed = itemState.countedMrp.trim();
    if (!trimmed) {
      updateUiState({ parsedMrpValue: null });
      return;
    }
    const value = parseFloat(trimmed);
    updateUiState({ parsedMrpValue: Number.isNaN(value) ? null : value });
  }, [itemState.countedMrp]);

  const mrpDifference = React.useMemo(() => {
    const baseMrp = itemState.currentItem?.mrp;
    if (
      uiState.parsedMrpValue === null ||
      baseMrp === undefined ||
      baseMrp === null
    ) {
      return null;
    }
    return uiState.parsedMrpValue - Number(baseMrp);
  }, [uiState.parsedMrpValue, itemState.currentItem]);

  const mrpChangePercent = React.useMemo(() => {
    if (
      mrpDifference === null ||
      uiState.parsedMrpValue === null ||
      itemState.currentItem?.mrp === undefined ||
      itemState.currentItem?.mrp === null ||
      Number(itemState.currentItem.mrp) === 0
    ) {
      return null;
    }
    return (mrpDifference / Number(itemState.currentItem.mrp)) * 100;
  }, [mrpDifference, uiState.parsedMrpValue, itemState.currentItem]);

  // Update mrpVariantOptions in itemState
  React.useEffect(() => {
    const variants = getNormalizedMrpVariants(itemState.currentItem);
    updateItemState({ mrpVariantOptions: variants });
  }, [itemState.currentItem]);

  const hasMrpChanged = React.useMemo(() => {
    if (mrpDifference === null || uiState.parsedMrpValue === null) {
      return false;
    }
    return Math.abs(mrpDifference) >= MRP_MATCH_TOLERANCE;
  }, [mrpDifference, uiState.parsedMrpValue]);

  const serialRequirement = React.useMemo(() => {
    if (!itemState.currentItem?.serial_requirement) {
      return 'optional';
    }
    return String(itemState.currentItem.serial_requirement).toLowerCase();
  }, [itemState.currentItem?.serial_requirement]);

  // Update requiredSerialCount in workflowState when serialRequirement changes
  React.useEffect(() => {
    let count = 0;
    if (serialRequirement === 'dual') {
      count = 2;
    } else if (serialRequirement === 'single' || serialRequirement === 'required') {
      count = 1;
    }
    updateWorkflowState({ requiredSerialCount: count });
  }, [serialRequirement]);

  const normalizedQuantity = React.useMemo(() => {
    const trimmedQty = itemState.countedQty.trim();
    if (!trimmedQty) {
      return 0;
    }
    const numericValue = parseFloat(trimmedQty);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }
    return Math.round(numericValue);
  }, [itemState.countedQty]);

  const serialsPerItem = React.useMemo(() => {
    switch (serialRequirement) {
      case 'dual':
        return 2;
      case 'single':
      case 'required':
        return 1;
      default:
        return workflowState.serialCaptureEnabled ? 1 : 0;
    }
  }, [serialRequirement, workflowState.serialCaptureEnabled]);

  // Update expectedSerialCount in workflowState
  React.useEffect(() => {
    if (normalizedQuantity <= 0) {
      updateWorkflowState({ expectedSerialCount: 0 });
      return;
    }

    const perItem = serialRequirement === 'optional' && !workflowState.serialCaptureEnabled ? 0 : serialsPerItem;
    if (perItem === 0) {
      updateWorkflowState({ expectedSerialCount: 0 });
      return;
    }

    updateWorkflowState({ expectedSerialCount: normalizedQuantity * perItem });
  }, [normalizedQuantity, serialRequirement, workflowState.serialCaptureEnabled, serialsPerItem]);

  const minimumSerialSlotCount = React.useMemo(() => {
    if (serialRequirement === 'optional') {
      return workflowState.serialCaptureEnabled ? Math.max(1, serialsPerItem) : 0;
    }
    return Math.max(workflowState.requiredSerialCount, serialsPerItem);
  }, [serialRequirement, workflowState.serialCaptureEnabled, workflowState.requiredSerialCount, serialsPerItem]);

  // Update serialInputTarget in workflowState
  React.useEffect(() => {
    const target = Math.max(workflowState.expectedSerialCount, minimumSerialSlotCount);
    updateWorkflowState({ serialInputTarget: target });
  }, [workflowState.expectedSerialCount, minimumSerialSlotCount]);

  const activeSerialEntries = React.useMemo(
    () => workflowState.serialInputs.filter((entry) => entry.value.trim().length > 0),
    [workflowState.serialInputs]
  );

  const completedSerialCount = activeSerialEntries.length;

  const missingSerialCount = React.useMemo(() => {
    if (workflowState.expectedSerialCount <= 0) {
      return 0;
    }
    return Math.max(workflowState.expectedSerialCount - completedSerialCount, 0);
  }, [workflowState.expectedSerialCount, completedSerialCount]);

  const extraSerialCount = React.useMemo(() => {
    if (workflowState.expectedSerialCount <= 0) {
      return 0;
    }
    return Math.max(completedSerialCount - workflowState.expectedSerialCount, 0);
  }, [workflowState.expectedSerialCount, completedSerialCount]);

  const serialPhotosRequired = React.useMemo(
    () => !isWeb && (workflowState.serialCaptureEnabled || workflowState.requiredSerialCount > 0) && activeSerialEntries.length > 0,
    [activeSerialEntries, isWeb, workflowState.requiredSerialCount, workflowState.serialCaptureEnabled]
  );

  const serialPhotoShortfall = React.useMemo(() => {
    if (!serialPhotosRequired) {
      return 0;
    }
    const serialPhotoCount = photoState.photoProofs.filter((photo) => photo.type === 'SERIAL').length;
    return Math.max(activeSerialEntries.length - serialPhotoCount, 0);
  }, [serialPhotosRequired, activeSerialEntries, photoState.photoProofs]);

  const serialRequirementMessage = React.useMemo((): string => {
    if (workflowState.expectedSerialCount > 0) {
      return `Capture ${workflowState.expectedSerialCount} serial number${workflowState.expectedSerialCount > 1 ? 's' : ''} (${completedSerialCount}/${workflowState.expectedSerialCount} recorded)`;
    }
    return SERIAL_REQUIREMENT_LABELS[serialRequirement] ?? SERIAL_REQUIREMENT_LABELS.optional ?? '';
  }, [workflowState.expectedSerialCount, completedSerialCount, serialRequirement]);

  const activeSerialLabel = React.useMemo(() => {
    if (!scannerState.serialScanTargetId) {
      return undefined;
    }
    const entry = workflowState.serialInputs.find((serial) => serial.id === scannerState.serialScanTargetId);
    return entry?.label ?? undefined;
  }, [scannerState.serialScanTargetId, workflowState.serialInputs]);

  React.useEffect(() => {
    loadVarianceReasons();
    loadAllItems();
  }, []);

  const loadVarianceReasons = async () => {
    try {
      const reasons = await getVarianceReasons();
      updateItemState({ varianceReasons: Array.isArray(reasons) ? reasons : [] });
    } catch {
      // Error logged via error handler
    }
  };

  const loadAllItems = async () => {
    try {
      const response = await api.get('/erp/items');
      // Handle both old format (array) and new format (object with items/pagination)
      const items = Array.isArray(response.data)
        ? response.data
        : (response.data.items || []);
      updateSearchState({ allItems: items });
    } catch {
      // Error logged via error handler
    }
  };

  const createSerialInput = React.useCallback(
    (index: number): SerialInput => ({
      id: `serial-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      label: `Serial #${index + 1}`,
      value: '',
    }),
    [],
  );

  const ensureInitialSerials = React.useCallback(
    (count: number) => Array.from({ length: count }, (_: unknown, idx: number) => createSerialInput(idx)),
    [createSerialInput]
  );

  const updateSerialValue = React.useCallback((id: string, rawValue: string) => {
    const normalized = normalizeSerialValue(rawValue);

    const currentSerials = workflowState.serialInputs;

    if (normalized.length === 0) {
      updateWorkflowState({
        serialInputs: currentSerials.map((entry) => (entry.id === id ? { ...entry, value: '' } : entry))
      });
      return;
    }

    if (
      currentSerials.some(
        (entry) =>
          entry.id !== id && normalizeSerialValue(entry.value) === normalized
      )
    ) {
      Alert.alert('Duplicate Serial', 'This serial number has already been recorded.');
      return;
    }

    updateWorkflowState({
      serialInputs: currentSerials.map((entry) => (entry.id === id ? { ...entry, value: normalized } : entry))
    });
  }, [workflowState.serialInputs]);

  const handleRemoveSerial = React.useCallback(
    (id: string) => {
      const minimumSerials = Math.max(workflowState.serialInputTarget, 0);
      if (workflowState.serialInputs.length <= minimumSerials) {
        if (minimumSerials > 0) {
          const detailMessage =
            workflowState.expectedSerialCount > 0
              ? `Capture ${workflowState.expectedSerialCount} serial number${workflowState.expectedSerialCount > 1 ? 's' : ''} to match the counted quantity.`
              : `Keep at least ${minimumSerials} serial number${minimumSerials > 1 ? 's' : ''} while serial capture is enabled.`;
          Alert.alert(
            'Serial Required',
            detailMessage
          );
        }
        return;
      }
      updateWorkflowState({
        serialInputs: workflowState.serialInputs.filter((entry) => entry.id !== id)
      });
      if (scannerState.serialScanTargetId === id) {
        updateScannerState({ serialScanTargetId: null });
      }
    },
    [workflowState.serialInputs, workflowState.serialInputTarget, workflowState.expectedSerialCount, scannerState.serialScanTargetId]
  );

  const handleToggleSerialCapture = React.useCallback(
    (value: boolean) => {
      if (workflowState.requiredSerialCount > 0) {
        updateWorkflowState({ serialCaptureEnabled: true });
        return;
      }

      updateWorkflowState({ serialCaptureEnabled: value });
      if (value) {
        const initialCount = Math.max(workflowState.serialInputTarget, 1);
        const currentSerials = workflowState.serialInputs;
        updateWorkflowState({
          serialInputs: currentSerials.length > 0 ? currentSerials : ensureInitialSerials(initialCount)
        });
      } else {
        updateWorkflowState({ serialInputs: [] });
      }
    },
    [workflowState.requiredSerialCount, workflowState.serialInputTarget, workflowState.serialInputs, ensureInitialSerials]
  );

  React.useEffect(() => {
    if (!itemState.currentItem) {
      updateWorkflowState({
        serialCaptureEnabled: false,
        serialInputs: []
      });
      updateItemState({
        itemCondition: 'good',
        conditionManuallySet: false,
        selectedVariant: null
      });
      return;
    }

    updateItemState({ conditionManuallySet: false });

    if (workflowState.requiredSerialCount > 0) {
      updateWorkflowState({
        serialCaptureEnabled: true,
        serialInputs: ensureInitialSerials(workflowState.requiredSerialCount)
      });
    } else {
      updateWorkflowState({
        serialCaptureEnabled: false,
        serialInputs: []
      });
    }

    updateItemState({ itemCondition: 'good' });
  }, [itemState.currentItem, ensureInitialSerials, workflowState.requiredSerialCount]);

  React.useEffect(() => {
    if (!itemState.currentItem) {
      return;
    }

    if (!workflowState.serialCaptureEnabled && workflowState.requiredSerialCount === 0) {
      if (workflowState.serialInputs.length > 0) {
        updateWorkflowState({ serialInputs: [] });
      }
      return;
    }

    if (workflowState.serialInputTarget <= 0) {
      if (workflowState.serialInputs.length > 0) {
        updateWorkflowState({ serialInputs: [] });
      }
      return;
    }

    if (
      workflowState.serialInputs.length === workflowState.serialInputTarget &&
      workflowState.serialInputs.every((entry, idx) => entry.label === `Serial #${idx + 1}`)
    ) {
      return;
    }

    const currentSerials = workflowState.serialInputs;
    const target = workflowState.serialInputTarget;
    let nextSerials = currentSerials;

    if (currentSerials.length > target) {
      nextSerials = currentSerials.slice(0, target);
    } else if (currentSerials.length < target) {
      const additions = Array.from({ length: target - currentSerials.length }, (_, idx) =>
        createSerialInput(currentSerials.length + idx)
      );
      nextSerials = [...currentSerials, ...additions];
    }

    const finalSerials = nextSerials.map((entry, idx) => ({
      ...entry,
      label: `Serial #${idx + 1}`,
    }));

    updateWorkflowState({ serialInputs: finalSerials });
  }, [itemState.currentItem, workflowState.serialInputs, workflowState.serialCaptureEnabled, workflowState.requiredSerialCount, workflowState.serialInputTarget, createSerialInput]);

  React.useEffect(() => {
    if (uiState.parsedMrpValue === null) {
      if (itemState.selectedVariant !== null) {
        updateItemState({ selectedVariant: null });
      }
      return;
    }

    const matched = itemState.mrpVariantOptions.find(
      (variant) => uiState.parsedMrpValue !== null && Math.abs(variant.value - uiState.parsedMrpValue) < MRP_MATCH_TOLERANCE
    );

    if (!matched) {
      if (itemState.selectedVariant !== null) {
        updateItemState({ selectedVariant: null });
      }
      return;
    }

    if (
      !itemState.selectedVariant ||
      itemState.selectedVariant.id !== matched.id ||
      Math.abs(itemState.selectedVariant.value - matched.value) >= MRP_MATCH_TOLERANCE ||
      itemState.selectedVariant.barcode !== matched.barcode
    ) {
      updateItemState({ selectedVariant: matched });
    }
  }, [uiState.parsedMrpValue, itemState.mrpVariantOptions, itemState.selectedVariant]);

  React.useEffect(() => {
    if (itemState.selectedVariant?.item_condition && !itemState.conditionManuallySet) {
      updateItemState({ itemCondition: itemState.selectedVariant.item_condition });
    }
  }, [itemState.selectedVariant, itemState.conditionManuallySet]);

  // Removed unused fuzzyMatch utility

  const handleSerialBarcodeCaptured = React.useCallback(
    (rawData: string) => {
      const normalized = normalizeSerialValue((rawData ?? '').toString());
      if (!normalized) {
        return;
      }

      if (!workflowState.serialCaptureEnabled && workflowState.requiredSerialCount === 0) {
        return;
      }

      if (!scannerState.serialScanTargetId) {
        updateUiState({ scanFeedback: 'Select a serial slot before scanning.' });
        setTimeout(() => updateUiState({ scanFeedback: '' }), 1500);
        return;
      }

      let duplicateDetected = false;
      let missingTarget = false;
      let nextTarget: string | null = null;

      const currentSerials = workflowState.serialInputs;
      const targetId = scannerState.serialScanTargetId;

      const targetExists = currentSerials.some((entry) => entry.id === targetId);
      if (!targetExists) {
        missingTarget = true;
      } else {
        if (
          currentSerials.some(
            (entry) =>
              entry.id !== targetId &&
              normalizeSerialValue(entry.value) === normalized
          )
        ) {
          duplicateDetected = true;
        } else {
          const updated = currentSerials.map((entry) =>
            entry.id === targetId ? { ...entry, value: normalized } : entry
          );

          const currentIndex = updated.findIndex((entry) => entry.id === targetId);
          if (currentIndex >= 0) {
            const nextEmpty = updated
              .slice(currentIndex + 1)
              .find((entry) => entry.value.trim().length === 0);
            if (nextEmpty) {
              nextTarget = nextEmpty.id;
            } else {
              const firstEmpty = updated.find((entry) => entry.value.trim().length === 0);
              if (firstEmpty) {
                nextTarget = firstEmpty.id;
              }
            }
          }

          updateWorkflowState({ serialInputs: updated });
        }
      }

      if (missingTarget) {
        Alert.alert('Serial Slot Removed', 'The selected serial slot is no longer available.');
        updateScannerState({ serialScanTargetId: null });
        updateUiState({
          showScanner: false,
          scannerMode: 'item'
        });
        return;
      }

      if (duplicateDetected) {
        Alert.alert('Duplicate Serial', 'This serial number has already been recorded.');
        return;
      }

      updateScannerState({
        lastScannedBarcode: normalized,
        scanTimestamp: Date.now()
      });
      updateUiState({ scanFeedback: `Serial captured: ${normalized}` });
      setTimeout(() => updateUiState({ scanFeedback: '' }), 2000);

      if (nextTarget) {
        updateScannerState({ serialScanTargetId: nextTarget });
      } else {
        updateScannerState({ serialScanTargetId: null });
        if (!uiState.continuousScanMode) {
          updateUiState({
            showScanner: false,
            scannerMode: 'item'
          });
        } else {
          updateUiState({ scanFeedback: 'Serial slots filled. Review entries.' });
          setTimeout(() => updateUiState({ scanFeedback: '' }), 2000);
        }
      }
    },
    [workflowState.serialCaptureEnabled, workflowState.requiredSerialCount, workflowState.serialInputs, scannerState.serialScanTargetId, uiState.continuousScanMode]
  );

  const handleSearch = React.useCallback((query: string) => {
    resetActivityTimer(); // Reset on search interaction

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    updateUiState({ searchQuery: query });

    if (query.trim().length === 0) {
      updateUiState({ searchResults: [], showSearchResults: false });
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        updateUiState({ isSearching: true });
        const results = await searchItems(query);
        // Convert Item[] to SearchResult[]
        const searchResults: SearchResult[] = results.map((item: Item) => ({
          item_code: item.item_code || item.id || '',
          item_name: item.name || '',
          barcode: item.barcode || '',
          stock_qty: item.stock_qty || item.quantity || 0,
          mrp: typeof item.mrp === 'number' ? item.mrp : (typeof item.mrp === 'string' ? parseFloat(item.mrp) : 0),
          category: item.category,
          warehouse: item.location,
          floor: undefined,
          rack: undefined,
          score: 1.0,
          matchType: 'exact' as const,
        }));
        updateUiState({ searchResults, showSearchResults: searchResults.length > 0 });
      } catch (error) {
        if (__DEV__) {
          console.error('Search failed:', error);
        }
        ErrorHandler.handleApiError(error, 'Item Search');
        Alert.alert('Error', 'Failed to search items');
      } finally {
        updateUiState({ isSearching: false });
      }
    }, 500);
  }, [resetActivityTimer, updateUiState]);

  const selectItemFromSearch = async (searchResult: SearchResult) => {
    resetActivityTimer(); // Reset on item selection

    // Clear manual inputs when item is selected
    updateUiState({
      manualBarcode: '',
      manualItemName: ''
    });
    updateSearchState({
      searchResults: [],
      showSearchResults: false
    });

    if (!sessionId) {
      Alert.alert('Error', 'Session ID is missing. Please restart the session.');
      return;
    }

    // Convert SearchResult to Item
    const item: Item = {
      id: searchResult.item_code,
      name: searchResult.item_name,
      item_code: searchResult.item_code,
      barcode: searchResult.barcode,
      stock_qty: searchResult.stock_qty,
      mrp: searchResult.mrp,
      category: searchResult.category,
      location: searchResult.warehouse,
    };

    // Check if already counted
    if (!sessionId || !item.item_code) {
      Alert.alert('Error', 'Session ID or item code is missing');
      return;
    }
    const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    if (!sessionIdStr) {
      Alert.alert('Error', 'Session ID is missing');
      return;
    }
    const countCheck = await checkItemCounted(sessionIdStr, item.item_code);

    if (countCheck.already_counted) {
      Alert.alert(
        'Item Already Counted',
        `This item was already counted ${countCheck.count_lines.length} time(s). Do you want to add another count?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Count', onPress: () => prepareItemForCounting(item) }
        ]
      );
    } else {
      prepareItemForCounting(item);
    }
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    resetActivityTimer(); // Reset on barcode scan

    const rawValue = (data ?? '').toString().trim();
    if (!rawValue) {
      return;
    }

    const now = Date.now();

    if (registerScanAndCheckRateLimit(rawValue, now)) {
      updateUiState({ scanFeedback: 'Too many scans detected, pause briefly.' });
      if (uiState.continuousScanMode) {
        updateUiState({ continuousScanMode: false });
      }
      setTimeout(() => updateUiState({ scanFeedback: '' }), 2000);
      return;
    }

    if (uiState.scannerMode === 'serial') {
      if (rawValue === scannerState.lastScannedBarcode && now - scannerState.scanTimestamp < 1000) {
        return;
      }
      handleSerialBarcodeCaptured(rawValue);
      return;
    }

    if (rawValue === scannerState.lastScannedBarcode && now - scannerState.scanTimestamp < 2000) {
      return;
    }

    updateScannerState({
      lastScannedBarcode: rawValue,
      scanTimestamp: now
    });
    updateUiState({ scanFeedback: `Scanned: ${rawValue}` });

    if (!uiState.continuousScanMode) {
      updateUiState({ showScanner: false });
    }

    await lookupItem(rawValue);

    setTimeout(() => updateUiState({ scanFeedback: '' }), 2000);
  };

  const ensureCameraPermission = React.useCallback(async () => {
    if (isWeb) {
      Alert.alert('Camera Unavailable', 'Camera access is not supported on web. Use manual options instead.');
      return false;
    }

    if (!permission) {
      const { status } = await requestPermission();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is required to use the camera');
        return false;
      }
      return true;
    }

    if (!permission.granted) {
      const { status } = await requestPermission();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is required to use the camera');
        return false;
      }
    }

    return true;
  }, [isWeb, permission, requestPermission]);

  const handleStartScanning = React.useCallback(
    async (mode: ScannerMode = 'item', targetSerialId?: string) => {
      if (isWeb) {
        Alert.alert('Scanner Unavailable', 'Barcode scanning via camera is not supported on web. Use manual entry instead.');
        return;
      }

      const permissionGranted = await ensureCameraPermission();
      if (!permissionGranted) {
        return;
      }

      if (mode === 'serial') {
        if (!workflowState.serialCaptureEnabled && workflowState.requiredSerialCount === 0) {
          Alert.alert('Serial Capture Disabled', 'Enable serial capture to scan serial numbers.');
          return;
        }

        let resolvedTarget = targetSerialId;
        if (!resolvedTarget) {
          const fallbackEntry = workflowState.serialInputs.find((entry) => entry.value.trim().length === 0) ?? workflowState.serialInputs[0];
          if (!fallbackEntry) {
            Alert.alert('No Serial Slots', 'Add a serial input before scanning serial numbers.');
            return;
          }
          resolvedTarget = fallbackEntry.id;
        }

        updateScannerState({ serialScanTargetId: resolvedTarget });
        if (photoState.selectedPhotoType !== 'SERIAL') {
          updatePhotoState({ selectedPhotoType: 'SERIAL' });
        }
      } else {
        updateScannerState({ serialScanTargetId: null });
      }

      updateUiState({
        scannerMode: mode,
        showScanner: true
      });
    },
    [ensureCameraPermission, isWeb, workflowState.requiredSerialCount, photoState.selectedPhotoType, workflowState.serialCaptureEnabled, workflowState.serialInputs]
  );

  const handleScanSerialSlot = React.useCallback(
    (entryId: string) => {
      handleStartScanning('serial', entryId);
    },
    [handleStartScanning]
  );

  const handleScanNextSerial = React.useCallback(() => {
    const targetEntry =
      workflowState.serialInputs.find((entry) => entry.value.trim().length === 0) ??
      workflowState.serialInputs[workflowState.serialInputs.length - 1];

    if (!targetEntry) {
      Alert.alert('No Serial Slots', 'Add a serial input before scanning serial numbers.');
      return;
    }

    handleStartScanning('serial', targetEntry.id);
  }, [workflowState.serialInputs, handleStartScanning]);

  const handleOpenPhotoCapture = React.useCallback(async () => {
    if (isWeb) {
      Alert.alert('Camera Unavailable', 'Photo capture uses device camera, which is not available on web.');
      return;
    }

    const permissionGranted = await ensureCameraPermission();
    if (!permissionGranted) {
      return;
    }
    updatePhotoState({ showPhotoCapture: true });
  }, [ensureCameraPermission, isWeb]);

  const handleCapturePhoto = React.useCallback(async () => {
    if (isWeb) {
      Alert.alert('Camera Unavailable', 'Photo capture is only available on mobile devices.');
      return;
    }

    if (!photoCameraRef.current) {
      Alert.alert('Camera Not Ready', 'Wait for the camera preview to initialize.');
      return;
    }

    try {
      updatePhotoState({ photoCaptureLoading: true });
      
      const photo = await photoCameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
        skipProcessing: false,
      });

      if (photo && photo.base64) {
        const newPhoto = {
          id: Date.now().toString(),
          uri: photo.uri,
          base64: photo.base64,
          type: photoState.selectedPhotoType,
          capturedAt: new Date().toISOString(),
        };

        updatePhotoState({
          photoProofs: [...photoState.photoProofs, newPhoto],
          showPhotoCapture: false,
        });
      } else {
        throw new Error('Failed to capture photo data');
      }
    } catch (error) {
      console.error('Photo capture error:', error);
      Alert.alert('Capture Failed', 'Unable to capture photo. Please try again.');
    } finally {
      updatePhotoState({ photoCaptureLoading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeb, photoState.selectedPhotoType, photoState.photoProofs]);

  const handleRemovePhoto = React.useCallback((photoId: string) => {
    updatePhotoState({
      photoProofs: photoState.photoProofs.filter((photo) => photo.id !== photoId)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoState.photoProofs]);

  const handleClosePhotoCapture = React.useCallback(() => {
    updatePhotoState({ showPhotoCapture: false });
  }, []);

  const handleFlipPhotoCamera = React.useCallback(() => {
    updatePhotoState({ photoCameraType: photoState.photoCameraType === 'back' ? 'front' : 'back' });
  }, [photoState.photoCameraType, updatePhotoState]);

  const [isLoadingItem, setIsLoadingItem] = React.useState(false);

  const lookupItem = async (barcode: string) => {
    if (!sessionId) {
      Alert.alert('Error', 'Session ID is missing');
      return;
    }
    setIsLoadingItem(true);
    updateScannerState({ scanFeedback: 'Looking up item...' });

    // Normalize barcode (unused previously) removed to avoid unused var warning

    try {
      // Barcode scan initiated

      // API call with power-saving throttle and proper offline support
      throttleNetworkRequest('barcode-scan', 300);
      const item = await getItemByBarcode(barcode, 3);

      // Item found

      // Track analytics
      AnalyticsService.trackItemScan(item.item_code, item.item_name).catch(() => { });

      updateScannerState({ scanFeedback: `Found: ${item.item_name}` });

      const countCheck = await checkItemCounted(sessionId, item.item_code);

      if (countCheck.already_counted) {
        // Item already counted - show options
        const existingLine = countCheck.count_lines[0];
        updateWorkflowState({ existingCountLine: existingLine });
        updateItemState({ currentItem: item });

        Alert.alert(
          '🔄 Duplicate Scan Detected',
          `${item.item_name}\n\nCurrent Count: ${existingLine.counted_qty} ${item.uom_name || ''}\nCounted by: ${existingLine.counted_by}\n\nWhat would you like to do?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resetForm() },
            {
              text: 'Add Quantity',
              onPress: () => {
                updateWorkflowState({ additionalQty: '1' });
                updateWorkflowState({ showAddQuantityModal: true });
              }
            },
            {
              text: 'Count Again',
              onPress: () => {
                updateWorkflowState({ existingCountLine: null });
                prepareItemForCounting(item);
                if (item.item_code) {
                  RecentItemsService.addRecent(item.item_code, item).catch(() => { });
                }
              }
            }
          ]
        );
      } else {
        prepareItemForCounting(item);
        // Add to recent items service
        if (item.item_code) {
          RecentItemsService.addRecent(item.item_code, item).catch(() => { });
        }
      }
    } catch (error: unknown) {
      // Use ErrorHandler for consistent error messages
      const apiError = ErrorHandler.handleApiError(error as Error, 'Barcode Lookup');

      // Build user-friendly message with context
      let errorTitle = apiError.category === 'network' ? 'Connection Error' :
        apiError.category === 'resource' ? 'Item Not Found' :
          apiError.category === 'validation' ? 'Invalid Barcode' : 'Error';

      let errorMessage = apiError.message;
      if (apiError.detail && apiError.detail !== apiError.message) {
        errorMessage += `\n\n${apiError.detail}`;
      }
      if (apiError.context?.barcode) {
        errorMessage += `\n\nBarcode: ${apiError.context.barcode}`;
      }

      updateScannerState({ scanFeedback: `Error: ${errorTitle}` });
      // Error logged via error handler
      ErrorHandler.logError('Barcode Lookup', error, {
        barcode,
        code: apiError.code,
        category: apiError.category,
        statusCode: apiError.statusCode,
        message: apiError.message,
      });

      // Build fix buttons based on error type
      const fixButtons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [
        { text: 'Cancel', style: 'cancel' }
      ];

      // Add context-specific fix buttons
      if (apiError.category === 'network') {
        fixButtons.push(
          {
            text: '🔌 Retry Connection',
            onPress: () => {
              updateScannerState({ scanFeedback: 'Checking backend...' });
              // Add delay to prevent rapid retries
              setTimeout(() => {
                lookupItem(barcode).catch(() => {
                  // Error already handled in lookupItem
                });
              }, 2000); // 2 second delay
            }
          },
          {
            text: '📡 Check Network',
            onPress: () => {
              Alert.alert('Network Check', 'Please ensure:\n\n• Device is connected to WiFi/Network\n• Backend server is running\n• Firewall allows connections');
            }
          }
        );
      } else if (apiError.category === 'resource' || apiError.category === 'database') {
        fixButtons.push(
          {
            text: '🔄 Try Again',
            onPress: () => {
              updateScannerState({ scanFeedback: 'Retrying...' });
              // Add delay to prevent rapid retries
              setTimeout(() => {
                lookupItem(barcode).catch(() => {
                  // Error already handled in lookupItem
                });
              }, 2000); // 2 second delay
            }
          },
          {
            text: '🔍 Search by Name',
            onPress: () => {
              updateScannerState({ showScanner: false });
              updateScannerState({ scanFeedback: 'Use search box above' });
            }
          },
          {
            text: '➕ Report Unknown Item',
            onPress: () => handleReportUnknownItem(barcode)
          }
        );
      } else if (apiError.category === 'validation') {
        fixButtons.push(
          {
            text: '✏️ Enter Manually',
            onPress: () => {
              updateScannerState({ showScanner: false });
              Alert.prompt(
                'Enter Barcode',
                'Please enter the barcode manually',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'OK',
                    onPress: (manualBarcode?: string) => {
                      if (manualBarcode && manualBarcode.trim()) {
                        lookupItem(manualBarcode.trim());
                      }
                    }
                  }
                ],
                'plain-text',
                barcode
              );
            }
          },
          {
            text: '🔍 Search Instead',
            onPress: () => {
              updateScannerState({ showScanner: false });
              updateScannerState({ scanFeedback: 'Use search box above' });
            }
          }
        );
      } else {
        // Generic fix buttons
        fixButtons.push(
          {
            text: '🔄 Retry',
            onPress: () => {
              updateScannerState({ scanFeedback: 'Retrying...' });
              // Add delay to prevent rapid retries
              setTimeout(() => {
                lookupItem(barcode).catch(() => {
                  // Error already handled in lookupItem
                });
              }, 2000); // 2 second delay
            }
          },
          {
            text: '🔍 Search by Name',
            onPress: () => {
              updateScannerState({ showScanner: false });
            }
          }
        );
      }

      // Enhanced error alert with fix buttons
      Alert.alert(
        errorTitle,
        errorMessage + '\n\nChoose an action:',
        fixButtons
      );
    } finally {
      setIsLoadingItem(false);
      // Clear feedback after 3 seconds
      setTimeout(() => updateScannerState({ scanFeedback: '' }), 3000);
    }
  };



  const handleReportUnknownItem = (barcode: string) => {
    updateUiState({ unknownItemData: { barcode, description: '' } });
    updateUiState({ showUnknownItemModal: true });
  };

  const submitUnknownItem = async () => {
    if (!uiState.unknownItemData.description.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }

    try {
      await api.post('/unknown-items', {
        barcode: uiState.unknownItemData.barcode,
        description: uiState.unknownItemData.description,
        session_id: sessionId,
        reported_by: 'staff'
      });
      Alert.alert('Success', 'Unknown item reported successfully');
      updateUiState({ showUnknownItemModal: false });
      updateUiState({ unknownItemData: { barcode: '', description: '' } });
    } catch {
      Alert.alert('Error', 'Failed to report unknown item');
    }
  };



  const handleSaveCount = handleSubmit(async (data) => {
    if (!sessionId) {
      Alert.alert('Error', 'Session ID is missing');
      return;
    }
    if (!itemState.currentItem) {
      Alert.alert('Error', 'No item selected');
      return;
    }

    const mrpInputValue = data.mrp.trim();
    let parsedMrp: number | null = null;
    if (mrpInputValue.length > 0) {
      const numericMrp = parseFloat(mrpInputValue);
      if (Number.isNaN(numericMrp)) {
        Alert.alert('Invalid MRP', 'Please enter a valid number for MRP');
        return;
      }
      if (numericMrp < 0) {
        Alert.alert('Invalid MRP', 'MRP cannot be negative');
        return;
      }
      parsedMrp = numericMrp;
    }

    // Parse damage quantities
    const returnableQty = data.returnableDamageQty.trim() ? parseFloat(data.returnableDamageQty) : 0;
    const nonReturnableQty = data.nonReturnableDamageQty.trim() ? parseFloat(data.nonReturnableDamageQty) : 0;
    const physicalQty = parseFloat(data.countedQty);

    // Variance calculation: (Physical + Returnable Damage) - Stock
    const totalCounted = physicalQty + returnableQty;
    const stockQty = itemState.currentItem.stock_qty ?? itemState.currentItem.quantity ?? 0;
    const variance = totalCounted - stockQty;

    if (variance !== 0 && !itemState.selectedReason) {
      updateUiState({ showReasonModal: true });
      return;
    }

    if (workflowState.expectedSerialCount > 0 && activeSerialEntries.length < workflowState.expectedSerialCount) {
      const remaining = workflowState.expectedSerialCount - activeSerialEntries.length;
      Alert.alert(
        'Serial Numbers Needed',
        `Capture ${workflowState.expectedSerialCount} serial number${workflowState.expectedSerialCount > 1 ? 's' : ''} to match the counted quantity. ${remaining} serial number${remaining > 1 ? 's are' : ' is'} still missing.`
      );
      return;
    }

    const serialPayload = activeSerialEntries.map((entry, index) => ({
      label: entry.label || `Serial #${index + 1}`,
      value: normalizeSerialValue(entry.value || ''),
      captured_at: new Date().toISOString(),
    }));

    if (workflowState.expectedSerialCount > 0 && serialPayload.length > workflowState.expectedSerialCount) {
      Alert.alert(
        'Serial Count Mismatch',
        'The number of serial numbers exceeds the counted quantity. Adjust the quantity or remove extra serial entries before saving.'
      );
      return;
    }

    if (serialPayload.length > 0 && serialPhotoShortfall > 0) {
      const remaining = serialPhotoShortfall;
      Alert.alert(
        'Serial Photos Needed',
        `Capture ${remaining} more serial photo proof${remaining > 1 ? 's' : ''} to match the recorded serial numbers.`
      );
      return;
    }

    const matchedVariant = itemState.selectedVariant ?? (parsedMrp !== null
      ? itemState.mrpVariantOptions.find((variant) => Math.abs(variant.value - parsedMrp!) < MRP_MATCH_TOLERANCE)
      : null);

    const shouldSendMrp = parsedMrp !== null && hasMrpChanged;
    const mrpSource = shouldSendMrp
      ? matchedVariant?.source ?? 'manual_entry'
      : undefined;

    const photoPayload = photoState.photoProofs.map((photo) => ({
      id: photo.id,
      type: photo.type,
      base64: photo.base64,
      captured_at: photo.capturedAt,
    }));

    try {
      updateUiState({ saving: true });

      const payload: CreateCountLinePayload = {
        session_id: sessionId,
        item_code: itemState.currentItem.item_code || '',
        counted_qty: physicalQty,
        damaged_qty: returnableQty,
        non_returnable_damaged_qty: nonReturnableQty,
        variance_reason: itemState.selectedReason || null,
        variance_note: itemState.varianceNote || null,
        remark: itemState.remark || null,
        item_condition: itemState.itemCondition || undefined,
        serial_numbers: serialPayload.length ? serialPayload : undefined,
        // Warehouse location fields (replacing session-based tracking)
        floor_no: itemState.floorNo.trim() || null,
        rack_no: itemState.rackNo.trim() || null,
        mark_location: itemState.markLocation.trim() || null,
        // Additional optional fields
        sr_no: itemState.srNo.trim() || null,
        manufacturing_date: itemState.manufacturingDate.trim() || null,
      };

      if (photoPayload.length > 0) {
        payload.photo_proofs = photoPayload;
      }

      if (shouldSendMrp && parsedMrp !== null) {
        payload.mrp_counted = parsedMrp;
        payload.mrp_source = mrpSource;
        payload.variant_id = matchedVariant?.id;
        payload.variant_barcode = matchedVariant?.barcode;
      }

      const countLine = await handleErrorWithRecovery(
        () => createCountLine(payload),
        {
          context: 'Save Count',
          recovery: { maxRetries: 3 },
          showAlert: true,
        }
      );

      // Mark item as verified
      try {
        if (!itemState.currentItem.item_code) {
          throw new Error('Item code is missing');
        }
        await ItemVerificationAPI.verifyItem(itemState.currentItem.item_code, {
          verified: true,
          verified_qty: physicalQty,
          damaged_qty: returnableQty,
          non_returnable_damaged_qty: nonReturnableQty,
          item_condition: itemState.itemCondition,
          notes: itemState.varianceNote || itemState.remark || undefined,
          floor: itemState.floorNo.trim() || undefined,
          rack: itemState.rackNo.trim() || undefined,
          session_id: sessionId,
          count_line_id: countLine?.id
        });
      } catch {
        // Verification tracking failed (non-critical)
        // Don't block the save if verification fails
      }

      // Track analytics
      if (itemState.currentItem.item_code) {
        AnalyticsService.trackCount(itemState.currentItem.item_code, physicalQty).catch(() => { });
      }

      Alert.alert('Success', 'Count saved successfully!');
      resetForm();
    } catch {
      // Error handled by handleErrorWithRecovery
      // Error logged via error handler
    } finally {
      updateUiState({ saving: false });
    }
  });

  // Voice search functionality
  const handleVoiceSearch = React.useCallback(async () => {
    if (searchState.isListening) {
      // Stop listening
      updateSearchState({ isListening: false });
      updateScannerState({ scanFeedback: '' });
      return;
    }

    // Start listening
    updateSearchState({ isListening: true });
    updateScannerState({ scanFeedback: '🎤 Listening... Speak item name or code' });
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Voice Search',
        'Enter item name or code (Voice input coming soon)',
        [
          {
            text: 'Cancel', style: 'cancel', onPress: () => {
              updateSearchState({ isListening: false });
              updateScannerState({ scanFeedback: '' });
            }
          },
          {
            text: 'Search', onPress: (text?: string) => {
              if (text && text.trim()) {
                updateScannerState({ manualItemName: text.trim() });
                handleSearch(text.trim());
              }
              updateSearchState({ isListening: false });
              updateScannerState({ scanFeedback: '' });
            }
          }
        ],
        'plain-text'
      );
      return;
    }

    Alert.alert(
      'Voice Search',
      'Voice search is currently supported on iOS only; use the search box instead.',
      [
        {
          text: 'OK',
          onPress: () => {
            updateSearchState({ isListening: false });
            updateScannerState({ scanFeedback: '' });
          },
        },
      ]
    );
  }, [searchState.isListening, updateSearchState, updateScannerState, handleSearch]);

  // Add quantity to existing count line
  const handleAddQuantity = React.useCallback(async () => {
    if (!workflowState.existingCountLine || !workflowState.additionalQty) {
      return;
    }

    const addQty = parseFloat(workflowState.additionalQty);
    if (isNaN(addQty) || addQty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid positive number');
      return;
    }

    try {
      updateUiState({ saving: true });
      const newTotalQty = (workflowState.existingCountLine.counted_qty || 0) + addQty;

      if (workflowState.existingCountLine?.id) {
        await addQuantityToCountLine(workflowState.existingCountLine.id, addQty);
      }

      Alert.alert(
        'Success',
        `Added ${addQty} to existing count\n\nNew Total: ${newTotalQty} ${itemState.currentItem?.uom_name || ''}`,
        [{
          text: 'OK', onPress: () => {
            updateWorkflowState({ showAddQuantityModal: false });
            resetForm();
          }
        }]
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add quantity';
      Alert.alert('Error', errorMessage);
    } finally {
      updateUiState({ saving: false });
    }
  }, [workflowState.existingCountLine, workflowState.additionalQty, itemState.currentItem]);

  const resetForm = () => {
    // Reset form values
    reset({
      countedQty: '',
      returnableDamageQty: '',
      nonReturnableDamageQty: '',
      mrp: '',
      remark: '',
      varianceNote: '',
    });

    // Reset item state
    updateItemState({
      currentItem: null,
      countedQty: '',
      countedMrp: '',
      selectedReason: '',
      varianceNote: '',
      remark: '',
      floorNo: '',
      rackNo: '',
      damageQty: '',
      markLocation: '',
      srNo: '',
      manufacturingDate: '',
      itemCondition: 'good',
      conditionManuallySet: false,
      selectedVariant: null,
      returnableDamageQty: '',
      nonReturnableDamageQty: ''
    });

    // Reset UI state
    updateUiState({
      scanFeedback: '',
      manualBarcode: '',
      manualItemName: '',
      showOptionalFields: false,
      selectedPhotoType: 'ITEM',
    });

    // Reset photo state
    updatePhotoState({ showPhotoCapture: false });

    // Reset search state
    updateSearchState({
      searchResults: [],
      showSearchResults: false
    });

    // Reset workflow state
    updateWorkflowState({
      serialCaptureEnabled: false,
      serialInputs: []
    });

    // Reset scanner state
    updateScannerState({
      serialScanTargetId: null
    });

    // Reset photo state
    updatePhotoState({
      photoProofs: []
    });
    // Reset duplicate scan handling
    updateWorkflowState({
      existingCountLine: null,
      showAddQuantityModal: false,
      additionalQty: ''
    });
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              router.replace('/login');
            } catch {
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleRefreshStock = async () => {
    if (!itemState.currentItem) return;

    updateUiState({ refreshingStock: true });
    try {
      if (!itemState.currentItem.item_code) {
        Alert.alert('Error', 'Item code is missing');
        return;
      }
      const result = await refreshItemStock(itemState.currentItem.item_code);
      if (result.success && result.item) {
        const previousMrp = itemState.currentItem?.mrp;
        const updatedItem = {
          ...itemState.currentItem,
          ...result.item,
        };

        // Update current item with latest stock from ERP
        updateItemState({ currentItem: updatedItem });

        // Calculate new MRP
        const recommendedMrp = getDefaultMrpForItem(updatedItem);
        const trimmedPrev = (itemState.countedMrp ?? '').trim();
        let newMrp = itemState.countedMrp;

        if (!trimmedPrev) {
          newMrp = recommendedMrp;
        } else {
          const prevValue = parseFloat(trimmedPrev);
          if (
            Number.isNaN(prevValue) ||
            (previousMrp !== undefined && previousMrp !== null && prevValue === Number(previousMrp))
          ) {
            newMrp = recommendedMrp;
          }
        }

        updateItemState({ countedMrp: newMrp });
        updateScannerState({ scanFeedback: `Stock refreshed: ${result.item.stock_qty}` });

        // Show success message
        Alert.alert(
          'Stock Refreshed',
          `Current ERP Stock: ${result.item.stock_qty}\n${result.message}`,
          [{ text: 'OK' }]
        );
      }
    } catch (error: unknown) {
      // Error logged via error handler
      const apiError = error as ApiErrorResponse;
      const detail = apiError?.response?.data?.detail;
      const errorMsg = (typeof detail === 'object' ? detail?.message : detail) 
        || apiError?.message 
        || 'Failed to refresh stock';
      Alert.alert('Error', errorMsg);
    } finally {
      updateUiState({ refreshingStock: false });
    }
  };

  if (!isWeb && !permission) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#00E676" size="large" />
        <Text style={[styles.text, { marginTop: 16, color: '#fff' }]}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!isWeb && permission && !permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color="#94A3B8" />
          <Text style={styles.permissionText}>Camera permission is required to scan barcodes</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0F172A' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {isWeb ? (
        <View style={[styles.container, { backgroundColor: '#0F172A' }]}>
          <StatusBar style="light" />


          {/* Session Start Modal */}
          <Modal
            visible={!uiState.sessionActive}
            animationType="slide"
            transparent={true}
            onRequestClose={() => { }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Start Session</Text>
                <Text style={styles.modalSubtitle}>Enter location details to begin</Text>

                <Text style={styles.modalLabel}>Floor Number</Text>
                <TextInput
                  style={styles.input}
                  value={itemState.floorNo}
                  onChangeText={(text) => updateItemState({ floorNo: text })}
                  placeholder="e.g. 1, 2, G"
                  placeholderTextColor="#666"
                />

                <Text style={styles.modalLabel}>Rack Number</Text>
                <TextInput
                  style={styles.input}
                  value={itemState.rackNo}
                  onChangeText={(text) => updateItemState({ rackNo: text })}
                  placeholder="e.g. A1, B2"
                  placeholderTextColor="#666"
                />

                <TouchableOpacity
                  style={[styles.confirmButton, !itemState.floorNo && { opacity: 0.5 }]}
                  onPress={() => {
                    if (itemState.floorNo) {
                      updateUiState({ sessionActive: true });
                    } else {
                      Alert.alert('Required', 'Please enter Floor number');
                    }
                  }}
                  disabled={!itemState.floorNo}
                >
                  <Text style={styles.confirmButtonText}>Start Scanning</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <BlurView intensity={20} tint="dark" style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Scan Items</Text>
              {user && (
                <Text style={styles.headerSubtitle}>{user.full_name || user.username}</Text>
              )}
            </View>
            <View style={styles.headerActions}>
              {/* Power Saving Indicator - commented out until component is created */}
              {/* <PowerSavingIndicator powerState={powerState} compact /> */}
              <TouchableOpacity
                onPress={() => updateWorkflowState({ autoIncrementEnabled: !workflowState.autoIncrementEnabled })}
                style={styles.toggleButton}
              >
                <Ionicons
                  name={workflowState.autoIncrementEnabled ? "add-circle" : "add-circle-outline"}
                  size={24}
                  color={workflowState.autoIncrementEnabled ? "#3B82F6" : "#94A3B8"}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/staff/history?sessionId=${sessionId}`)}
                style={styles.historyButton}
              >
                <Ionicons name="list" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleLogout}
                style={styles.logoutButton}
              >
                <Ionicons name="log-out-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </BlurView>

          {/* Auto-Increment Status Banner */}
          {workflowState.autoIncrementEnabled && (
            <View style={styles.autoIncrementBanner}>
              <Ionicons name="information-circle" size={16} color="#3B82F6" />
              <Text style={styles.autoIncrementText}>
                Auto-Increment ON - Re-scanning items will add to count
              </Text>
            </View>
          )}

          <ScrollView style={styles.content}>
            {!itemState.currentItem ? (
              <View>
                {/* Scan Option */}
                {isWeb && (
                  <View style={styles.webNotice}>
                    <Ionicons name="desktop-outline" size={20} color="#FFB74D" />
                    <Text style={styles.webNoticeText}>
                      Camera scanning is not available on web. Use manual entry below.
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.scanButton, isWeb && styles.scanButtonDisabled, { paddingVertical: 12, minHeight: 60 }]}
                  onPress={() => handleStartScanning('item')}
                  disabled={isWeb}
                >
                  <Ionicons name="scan" size={24} color="#fff" />
                  <Text style={[styles.scanButtonText, { fontSize: 16, marginLeft: 8 }]}>Scan Barcode</Text>
                </TouchableOpacity>

                <View style={styles.orDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.orText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Manual Entry Section - Using ItemSearch Component */}
                <ItemSearch
                  manualBarcode={scannerState.manualBarcode}
                  manualItemName={scannerState.manualItemName}
                  searchResults={uiState.searchResults}
                  isSearching={uiState.isSearching}
                  isListening={searchState.isListening}
                  showSearchResults={uiState.showSearchResults}
                  onBarcodeChange={(barcode) => updateScannerState({ manualBarcode: barcode })}
                  onItemNameChange={(name) => updateScannerState({ manualItemName: name })}
                  onBarcodeSubmit={() => {
                    if (scannerState.manualBarcode.trim()) {
                      lookupItem(scannerState.manualBarcode.trim());
                    }
                  }}
                  onItemNameSubmit={() => {
                    if (scannerState.manualItemName.trim().length >= 3) {
                      handleSearch(scannerState.manualItemName.trim());
                    }
                  }}
                  onSearch={handleSearch}
                  onVoiceSearch={handleVoiceSearch}
                  onSelectItem={selectItemFromSearch}
                  onActivityReset={resetActivityTimer}
                  onScan={() => handleStartScanning('item')}
                />
              </View>
            ) : (
              <View>
                {/* Item Display - Using ItemDisplay Component */}
                <ItemDisplay
                  item={itemState.currentItem}
                  refreshingStock={uiState.refreshingStock}
                  onRefreshStock={handleRefreshStock}
                />

                {/* Quantity Input Form - Using QuantityInputForm Component */}
                <QuantityInputForm
                  control={control}
                  errors={errors}
                  setValue={setValue}
                  mrpVariants={itemState.mrpVariantOptions}
                  parsedMrpValue={uiState.parsedMrpValue}
                  systemMrp={itemState.currentItem?.mrp ? toNumericMrp(itemState.currentItem.mrp) : null}
                  mrpDifference={mrpDifference}
                  mrpChangePercent={mrpChangePercent}
                  onActivityReset={resetActivityTimer}
                  onItemConditionChange={(condition) => updateItemState({ itemCondition: condition })}
                  onVariantSelect={(variant) => {
                    setValue('mrp', formatMrpValue(variant.value));
                    updateItemState({ countedMrp: formatMrpValue(variant.value), selectedVariant: variant });
                  }}
                  currentItemCondition={itemState.itemCondition}
                />

                {/* Warehouse Location Section (replacing session-based tracking) */}
                <LocationInput
                  floorNo={itemState.floorNo}
                  rackNo={itemState.rackNo}
                  shelfNo={itemState.shelfNo}
                  markLocation={itemState.markLocation}
                  onFloorChange={(text) => updateItemState({ floorNo: text })}
                  onRackChange={(text) => updateItemState({ rackNo: text })}
                  onShelfChange={(text) => updateItemState({ shelfNo: text })}
                  onMarkLocationChange={(text) => updateItemState({ markLocation: text })}
                  showRack={true}
                  showShelf={true}
                  onActivityReset={resetActivityTimer}
                />

                {/* Optional Additional Fields Section */}
                <View style={styles.optionalFieldsSection}>
                  <TouchableOpacity
                    style={styles.optionalFieldsToggle}
                    onPress={() => {
                      resetActivityTimer();
                      updateUiState({ showOptionalFields: !uiState.showOptionalFields });
                    }}
                  >
                    <Text style={styles.optionalFieldsToggleText}>Optional Fields</Text>
                    <Ionicons
                      name={uiState.showOptionalFields ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color="#3B82F6"
                    />
                  </TouchableOpacity>

                  {uiState.showOptionalFields && (
                    <View style={styles.optionalFieldsContent}>
                      <View style={styles.optionalFieldRow}>
                        <View style={styles.optionalFieldGroup}>
                          <Text style={styles.fieldLabel}>SR No</Text>
                          <TextInput
                            style={styles.optionalInput}
                            placeholder="Serial/Reference No"
                            placeholderTextColor="#94A3B8"
                            value={itemState.srNo}
                            onChangeText={(text) => {
                              resetActivityTimer();
                              updateItemState({ srNo: text });
                            }}
                            autoCapitalize="characters"
                          />
                        </View>
                      </View>

                      <View style={styles.optionalFieldRow}>
                        <View style={styles.optionalFieldGroup}>
                          <Text style={styles.fieldLabel}>Manufacturing Date</Text>
                          <TouchableOpacity
                            style={styles.datePickerButton}
                            onPress={() => {
                              resetActivityTimer();
                              setShowManufacturingDatePicker(true);
                            }}
                          >
                            <Ionicons name="calendar" size={18} color="#666" />
                            <Text style={styles.datePickerButtonText}>
                              {itemState.manufacturingDate || 'Select Date'}
                            </Text>
                          </TouchableOpacity>
                          {itemState.manufacturingDate && (
                            <TouchableOpacity
                              style={styles.clearDateButton}
                              onPress={() => {
                                resetActivityTimer();
                                updateItemState({ manufacturingDate: '' });
                              }}
                            >
                              <Ionicons name="close-circle" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Display read-only Category, Type, Group from current item */}
                      {(itemState.currentItem.category || itemState.currentItem.item_type || itemState.currentItem.item_group) && (
                        <View style={styles.readOnlyInfoSection}>
                          <Text style={styles.readOnlyInfoTitle}>Item Information</Text>
                          {itemState.currentItem.category && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Category:</Text>
                              <Text style={styles.readOnlyInfoValue}>
                                {itemState.currentItem.category}
                                {itemState.currentItem.subcategory && ` / ${itemState.currentItem.subcategory}`}
                              </Text>
                            </View>
                          )}
                          {itemState.currentItem.item_type && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Type:</Text>
                              <Text style={styles.readOnlyInfoValue}>{itemState.currentItem.item_type}</Text>
                            </View>
                          )}
                          {itemState.currentItem.item_group && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Group:</Text>
                              <Text style={styles.readOnlyInfoValue}>{itemState.currentItem.item_group}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Damage Quantity Section */}
                <View style={styles.damageSection}>
                  <View style={styles.damageHeader}>
                    <Text style={styles.subSectionTitle}>Damage Quantity</Text>
                    <View style={styles.damageToggleRow}>
                      <Text style={styles.damageToggleLabel}>Enable</Text>
                      <Switch
                        value={workflowState.damageQtyEnabled}
                        onValueChange={(value) => {
                          resetActivityTimer();
                          updateWorkflowState({ damageQtyEnabled: value });
                          if (!value) {
                            updateItemState({ damageQty: '' });
                          }
                        }}
                        trackColor={{ false: '#555', true: '#EF4444' }}
                        thumbColor={workflowState.damageQtyEnabled ? '#ffebee' : '#f4f3f4'}
                      />
                    </View>
                  </View>
                  {workflowState.damageQtyEnabled && (
                    <View style={styles.damageInputContainer}>
                      <Text style={styles.fieldLabel}>Damaged Quantity</Text>
                      <TextInput
                        style={styles.damageInput}
                        placeholder="Enter damaged quantity"
                        placeholderTextColor="#94A3B8"
                        value={itemState.damageQty}
                        onChangeText={(text) => {
                          resetActivityTimer();
                          updateItemState({ damageQty: text });
                        }}
                        keyboardType="numeric"
                      />
                      <Text style={styles.damageHelperText}>
                        Track items that are damaged or defective
                      </Text>
                    </View>
                  )}
                </View>

                {/* Serial Number Entry - Using SerialNumberEntry Component */}
                <SerialNumberEntry
                  serialInputs={workflowState.serialInputs}
                  requiredSerialCount={workflowState.requiredSerialCount}
                  serialCaptureEnabled={workflowState.serialCaptureEnabled}
                  serialInputTarget={workflowState.serialInputTarget}
                  expectedSerialCount={workflowState.expectedSerialCount}
                  scannerMode={uiState.scannerMode}
                  serialScanTargetId={scannerState.serialScanTargetId}
                  showScanner={uiState.showScanner}
                  continuousScanMode={uiState.continuousScanMode}
                  serialRequirementMessage={serialRequirementMessage}
                  missingSerialCount={missingSerialCount}
                  extraSerialCount={extraSerialCount}
                  onToggleSerialCapture={handleToggleSerialCapture}
                  onSerialValueChange={updateSerialValue}
                  onScanSerialSlot={handleScanSerialSlot}
                  onRemoveSerial={handleRemoveSerial}
                  onScanNextSerial={handleScanNextSerial}
                  onAddSerial={() => {
                    const newInput = createSerialInput(workflowState.serialInputs.length);
                    addSerialInput(newInput);
                  }}
                  onActivityReset={resetActivityTimer}
                />

                <View style={styles.conditionSection}>
                  <Text style={styles.subSectionTitle}>Item Condition</Text>
                  <Text style={styles.conditionHelper}>Helps supervisors prioritise follow-up actions.</Text>
                  <View style={styles.conditionChips}>
                    {ITEM_CONDITION_OPTIONS.map((option) => {
                      const isActive = itemState.itemCondition === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[styles.conditionChip, isActive && styles.conditionChipActive]}
                          onPress={() => {
                            updateItemState({
                              itemCondition: option.value,
                              conditionManuallySet: true
                            });
                          }}
                        >
                          <Text style={[styles.conditionChipText, isActive && styles.conditionChipTextActive]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Photo Capture - Using PhotoCapture Component */}
                <PhotoCapture
                  photos={photoState.photoProofs}
                  selectedPhotoType={photoState.selectedPhotoType}
                  showPhotoCapture={photoState.showPhotoCapture}
                  photoCaptureLoading={photoState.photoCaptureLoading}
                  photoCameraType={photoState.photoCameraType}
                  isWeb={isWeb}
                  serialPhotosRequired={serialPhotosRequired}
                  serialPhotoShortfall={serialPhotoShortfall}
                  photoCameraRef={photoCameraRef}
                  onPhotoTypeChange={(type) => updatePhotoState({ selectedPhotoType: type })}
                  onOpenPhotoCapture={handleOpenPhotoCapture}
                  onClosePhotoCapture={handleClosePhotoCapture}
                  onCapturePhoto={handleCapturePhoto}
                  onFlipCamera={handleFlipPhotoCamera}
                  onRemovePhoto={handleRemovePhoto}
                />



                {itemState.countedQty && (
                  <View style={styles.varianceBox}>
                    <Text style={styles.varianceLabel}>Variance:</Text>
                    <Text style={[styles.varianceValue, (parseFloat(itemState.countedQty) - (itemState.currentItem?.stock_qty || 0)) !== 0 && styles.varianceNonZero]}>
                      {(parseFloat(itemState.countedQty) - (itemState.currentItem?.stock_qty || 0)).toFixed(2)}
                    </Text>
                  </View>
                )}

                <TextInput
                  style={styles.remarkInput}
                  placeholder="Optional remark"
                  placeholderTextColor="#94A3B8"
                  value={itemState.remark}
                  onChangeText={(text) => updateItemState({ remark: text })}
                  multiline
                />

                <View style={styles.actionButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, uiState.saving && styles.buttonDisabled]}
                    onPress={handleSaveCount}
                    disabled={uiState.saving}
                  >
                    <Text style={styles.saveButtonText}>{uiState.saving ? 'Saving...' : 'Save Count'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Barcode Scanner - Using BarcodeScanner Component */}
          <BarcodeScanner
            visible={uiState.showScanner}
            scannerMode={uiState.scannerMode}
            continuousScanMode={uiState.continuousScanMode}
            isLoadingItem={isLoadingItem}
            scanFeedback={uiState.scanFeedback || scannerState.scanFeedback}
            serialLabel={activeSerialLabel}
            expectedSerialCount={workflowState.expectedSerialCount}
            completedSerialCount={completedSerialCount}
            isWeb={isWeb}
            onBarcodeScanned={handleBarCodeScanned}
            onClose={() => {
              updateUiState({ showScanner: false, scannerMode: 'item' });
              updateScannerState({ serialScanTargetId: null });
            }}
            onToggleContinuousMode={() => updateUiState({ continuousScanMode: !uiState.continuousScanMode })}
          />

          {
            !isWeb && (
              <Modal visible={photoState.showPhotoCapture} animationType="slide">
                <View style={styles.photoModalContainer}>
                  <CameraView
                    ref={photoCameraRef}
                    style={styles.photoCamera}
                    facing={photoState.photoCameraType}
                    ratio="16:9"
                  />
                  <View style={styles.photoModalOverlay}>
                    <View style={styles.photoModalTopBar}>
                      <TouchableOpacity style={styles.photoModalButton} onPress={handleClosePhotoCapture}>
                        <Ionicons name="close" size={28} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.photoModalButton} onPress={handleFlipPhotoCamera}>
                        <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.photoShutterBar}>
                      <TouchableOpacity
                        style={styles.photoShutterButton}
                        onPress={handleCapturePhoto}
                        disabled={photoState.photoCaptureLoading}
                      >
                        {photoState.photoCaptureLoading ? (
                          <ActivityIndicator size="small" color="#1E293B" />
                        ) : (
                          <Ionicons name="radio-button-on" size={64} color="#1E293B" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>
            )
          }

          {/* Variance Reason Modal */}
          <Modal visible={uiState.showReasonModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Variance Reason Required</Text>
                <Text style={styles.modalSubtitle}>Please select a reason for the variance</Text>

                {itemState.varianceReasons?.map((reason: VarianceReason) => (
                  <TouchableOpacity
                    key={reason.code}
                    style={[styles.reasonOption, itemState.selectedReason === reason.code && styles.reasonSelected]}
                    onPress={() => updateItemState({ selectedReason: reason.code })}
                  >
                    <Text style={styles.reasonText}>{reason.label}</Text>
                  </TouchableOpacity>
                ))}

                {itemState.selectedReason === 'other' && (
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Enter reason"
                    placeholderTextColor="#94A3B8"
                    value={itemState.varianceNote}
                    onChangeText={(text) => updateItemState({ varianceNote: text })}
                    multiline
                  />
                )}

                <TouchableOpacity
                  style={[styles.confirmButton, !itemState.selectedReason && styles.buttonDisabled]}
                  onPress={() => {
                    if (itemState.selectedReason) {
                      updateUiState({ showReasonModal: false });
                      handleSaveCount();
                    }
                  }}
                  disabled={!itemState.selectedReason}
                >
                  <Text style={styles.confirmButtonText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Unknown Item Report Modal */}
          <Modal visible={uiState.showUnknownItemModal} transparent animationType="fade">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalOverlay}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => updateUiState({ showUnknownItemModal: false })}
              >
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Ionicons name="alert-circle-outline" size={48} color="#FF9800" />
                      <Text style={styles.modalTitle}>Report Unknown Item</Text>
                    </View>

                    <View style={styles.unknownItemInfo}>
                      <Text style={styles.modalLabel}>Barcode:</Text>
                      <Text style={styles.unknownBarcode}>{uiState.unknownItemData.barcode}</Text>
                    </View>

                    <Text style={styles.modalLabel}>Description / Notes:</Text>
                    <TextInput
                      style={[styles.noteInput, styles.unknownItemInput]}
                      placeholder="Enter item description, brand, size, etc."
                      placeholderTextColor="#666"
                      value={uiState.unknownItemData.description}
                      onChangeText={(text) => updateUiState({ unknownItemData: { ...uiState.unknownItemData, description: text } })}
                      multiline
                      numberOfLines={4}
                      autoFocus
                    />

                    <Text style={styles.helpText}>
                      This item will be reported to the supervisor for review and manual entry into the system.
                    </Text>

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          updateUiState({
                            showUnknownItemModal: false,
                            unknownItemData: { barcode: '', description: '' }
                          });
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalSubmitButton]}
                        onPress={submitUnknownItem}
                      >
                        <Text style={styles.modalSubmitButtonText}>Report Item</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* Add Quantity Modal */}
          <Modal visible={workflowState.showAddQuantityModal} transparent animationType="slide">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalOverlay}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => updateWorkflowState({ showAddQuantityModal: false })}
              >
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Ionicons name="add-circle-outline" size={48} color="#3B82F6" />
                      <Text style={styles.modalTitle}>Add Quantity</Text>
                    </View>

                    {itemState.currentItem && workflowState.existingCountLine && (
                      <View style={styles.addQtyInfo}>
                        <Text style={styles.addQtyItemName}>{itemState.currentItem.name}</Text>
                        <Text style={styles.addQtyItemCode}>{itemState.currentItem.item_code}</Text>

                        <View style={styles.addQtyCurrentContainer}>
                          <Text style={styles.addQtyLabel}>Current Count:</Text>
                          <Text style={styles.addQtyValue}>
                            {workflowState.existingCountLine.counted_qty || 0} {itemState.currentItem.uom_name || ''}
                          </Text>
                        </View>

                        <View style={styles.addQtyInputContainer}>
                          <Text style={styles.addQtyLabel}>Add Quantity:</Text>
                          <TextInput
                            style={styles.addQtyInput}
                            placeholder="Enter quantity to add"
                            placeholderTextColor="#94A3B8"
                            value={workflowState.additionalQty}
                            onChangeText={(text) => updateWorkflowState({ additionalQty: text })}
                            keyboardType="numeric"
                            autoFocus
                          />
                        </View>

                        {workflowState.additionalQty && !isNaN(parseFloat(workflowState.additionalQty)) && (
                          <View style={styles.addQtyNewTotal}>
                            <Text style={styles.addQtyLabel}>New Total:</Text>
                            <Text style={styles.addQtyTotalValue}>
                              {((workflowState.existingCountLine.counted_qty || 0) + parseFloat(workflowState.additionalQty)).toFixed(2)} {itemState.currentItem.uom_name || ''}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          updateWorkflowState({ showAddQuantityModal: false, additionalQty: '' });
                          resetForm();
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.modalButton,
                          styles.modalSubmitButton,
                          (!workflowState.additionalQty || isNaN(parseFloat(workflowState.additionalQty)) || parseFloat(workflowState.additionalQty) <= 0) && styles.buttonDisabled
                        ]}
                        onPress={handleAddQuantity}
                        disabled={!workflowState.additionalQty || isNaN(parseFloat(workflowState.additionalQty)) || parseFloat(workflowState.additionalQty) <= 0 || uiState.saving}
                      >
                        {uiState.saving ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.modalSubmitButtonText}>Add Quantity</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* Manufacturing Date Picker Modal */}
          {
            showManufacturingDatePicker && Platform.OS !== 'web' && (
              <Modal visible={showManufacturingDatePicker} transparent animationType="fade">
                <TouchableOpacity
                  style={styles.modalOverlay}
                  activeOpacity={1}
                  onPress={() => setShowManufacturingDatePicker(false)}
                >
                  <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                    <View style={styles.datePickerModal}>
                      <Text style={styles.datePickerTitle}>Manufacturing Date</Text>
                      <View style={styles.datePickerContainer}>
                        <TextInput
                          style={styles.dateInput}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor="#94A3B8"
                          value={itemState.manufacturingDate}
                          onChangeText={(text) => {
                            resetActivityTimer();
                            updateItemState({ manufacturingDate: text });
                          }}
                          autoCapitalize="none"
                        />
                      </View>
                      <View style={styles.modalButtons}>
                        <TouchableOpacity
                          style={[styles.modalButton, styles.modalCancelButton]}
                          onPress={() => setShowManufacturingDatePicker(false)}
                        >
                          <Text style={styles.modalCancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.modalButton, styles.modalSubmitButton]}
                          onPress={() => {
                            resetActivityTimer();
                            setShowManufacturingDatePicker(false);
                          }}
                        >
                          <Text style={styles.modalSubmitButtonText}>Done</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Modal>
            )
          }
        </View>
      ) : (
        <LinearGradient
          colors={[PremiumTheme.colors.background, PremiumTheme.colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.container}
        >
          <StatusBar style="light" />

          {/* Session Start Modal */}
          <Modal
            visible={!uiState.sessionActive}
            animationType="slide"
            transparent={true}
            onRequestClose={() => { }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Start Session</Text>
                <Text style={styles.modalSubtitle}>Enter location details to begin</Text>

                <Text style={styles.modalLabel}>Floor Number</Text>
                <TextInput
                  style={styles.input}
                  value={itemState.floorNo}
                  onChangeText={(text) => updateItemState({ floorNo: text })}
                  placeholder="e.g. 1, 2, G"
                  placeholderTextColor="#666"
                />

                <Text style={styles.modalLabel}>Rack Number</Text>
                <TextInput
                  style={styles.input}
                  value={itemState.rackNo}
                  onChangeText={(text) => updateItemState({ rackNo: text })}
                  placeholder="e.g. A1, B2"
                  placeholderTextColor="#666"
                />

                <TouchableOpacity
                  style={[styles.confirmButton, !itemState.floorNo && { opacity: 0.5 }]}
                  onPress={() => {
                    if (itemState.floorNo) {
                      updateUiState({ sessionActive: true });
                    } else {
                      Alert.alert('Required', 'Please enter Floor number');
                    }
                  }}
                  disabled={!itemState.floorNo}
                >
                  <Text style={styles.confirmButtonText}>Start Scanning</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {Platform.OS === 'ios' ? (
            <BlurView intensity={20} tint="dark" style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Scan Items</Text>
                {user && (
                  <Text style={styles.headerSubtitle}>{user.full_name || user.username}</Text>
                )}
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={() => updateWorkflowState({ autoIncrementEnabled: !workflowState.autoIncrementEnabled })}
                  style={styles.toggleButton}
                >
                  <Ionicons
                    name={workflowState.autoIncrementEnabled ? "add-circle" : "add-circle-outline"}
                    size={24}
                    color={workflowState.autoIncrementEnabled ? "#3B82F6" : "#94A3B8"}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push(`/staff/history?sessionId=${sessionId}`)}
                  style={styles.historyButton}
                >
                  <Ionicons name="list" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleLogout}
                  style={styles.logoutButton}
                >
                  <Ionicons name="log-out-outline" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </BlurView>
          ) : (
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Scan Items</Text>
                {user && (
                  <Text style={styles.headerSubtitle}>{user.full_name || user.username}</Text>
                )}
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={() => updateWorkflowState({ autoIncrementEnabled: !workflowState.autoIncrementEnabled })}
                  style={styles.toggleButton}
                >
                  <Ionicons
                    name={workflowState.autoIncrementEnabled ? "add-circle" : "add-circle-outline"}
                    size={24}
                    color={workflowState.autoIncrementEnabled ? "#3B82F6" : "#94A3B8"}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push(`/staff/history?sessionId=${sessionId}`)}
                  style={styles.historyButton}
                >
                  <Ionicons name="list" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleLogout}
                  style={styles.logoutButton}
                >
                  <Ionicons name="log-out-outline" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Auto-Increment Status Banner */}
          {workflowState.autoIncrementEnabled && (
            <View style={styles.autoIncrementBanner}>
              <Ionicons name="information-circle" size={16} color="#3B82F6" />
              <Text style={styles.autoIncrementText}>
                Auto-Increment ON - Re-scanning items will add to count
              </Text>
            </View>
          )}

          <ScrollView style={styles.content}>
            {!itemState.currentItem ? (
              <View>
                <TouchableOpacity
                  style={styles.scanButton}
                  onPress={() => handleStartScanning('item')}
                >
                  <Ionicons name="scan" size={48} color="#fff" />
                  <Text style={styles.scanButtonText}>Scan Barcode</Text>
                </TouchableOpacity>

                <View style={styles.orDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.orText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Manual Entry Section - Using ItemSearch Component */}
                <ItemSearch
                  manualBarcode={scannerState.manualBarcode}
                  manualItemName={scannerState.manualItemName}
                  searchResults={uiState.searchResults}
                  isSearching={uiState.isSearching}
                  isListening={searchState.isListening}
                  showSearchResults={uiState.showSearchResults}
                  onBarcodeChange={(barcode) => updateScannerState({ manualBarcode: barcode })}
                  onItemNameChange={(name) => updateScannerState({ manualItemName: name })}
                  onBarcodeSubmit={() => {
                    if (scannerState.manualBarcode.trim()) {
                      lookupItem(scannerState.manualBarcode.trim());
                    }
                  }}
                  onItemNameSubmit={() => {
                    if (scannerState.manualItemName.trim().length >= 3) {
                      handleSearch(scannerState.manualItemName.trim());
                    }
                  }}
                  onSearch={handleSearch}
                  onVoiceSearch={handleVoiceSearch}
                  onSelectItem={selectItemFromSearch}
                  onActivityReset={resetActivityTimer}
                />
              </View>
            ) : (
              <View>
                {/* Item Display - Using ItemDisplay Component */}
                <ItemDisplay
                  item={itemState.currentItem}
                  refreshingStock={uiState.refreshingStock}
                  onRefreshStock={handleRefreshStock}
                />

                {/* Quantity Input Form - Using QuantityInputForm Component */}
                <QuantityInputForm
                  control={control}
                  errors={errors}
                  setValue={setValue}
                  mrpVariants={itemState.mrpVariantOptions}
                  parsedMrpValue={uiState.parsedMrpValue}
                  systemMrp={itemState.currentItem?.mrp ? toNumericMrp(itemState.currentItem.mrp) : null}
                  mrpDifference={mrpDifference}
                  mrpChangePercent={mrpChangePercent}
                  onActivityReset={resetActivityTimer}
                  onItemConditionChange={(condition) => updateItemState({ itemCondition: condition })}
                  onVariantSelect={(variant) => {
                    setValue('mrp', formatMrpValue(variant.value));
                    updateItemState({ countedMrp: formatMrpValue(variant.value), selectedVariant: variant });
                  }}
                  currentItemCondition={itemState.itemCondition}
                />

                {/* Warehouse Location Section (replacing session-based tracking) */}
                <View style={styles.locationSection}>
                  <Text style={styles.sectionTitle}>Warehouse Location</Text>
                  <View style={styles.locationGrid}>
                    <View style={styles.locationInputGroup}>
                      <Text style={styles.fieldLabel}>Floor No</Text>
                      <TextInput
                        style={styles.locationInput}
                        placeholder="e.g., 1, 2, G"
                        placeholderTextColor="#94A3B8"
                        value={itemState.floorNo}
                        onChangeText={(text) => {
                          resetActivityTimer();
                          updateItemState({ floorNo: text });
                        }}
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={styles.locationInputGroup}>
                      <Text style={styles.fieldLabel}>Mark/Label</Text>
                      <TextInput
                        style={styles.locationInput}
                        placeholder="e.g., Top, Middle"
                        placeholderTextColor="#94A3B8"
                        value={itemState.markLocation}
                        onChangeText={(text) => {
                          resetActivityTimer();
                          updateItemState({ markLocation: text });
                        }}
                        autoCapitalize="words"
                      />
                    </View>
                  </View>
                </View>

                {/* Optional Additional Fields Section */}
                <View style={styles.optionalFieldsSection}>
                  <TouchableOpacity
                    style={styles.optionalFieldsToggle}
                    onPress={() => {
                      resetActivityTimer();
                      updateUiState({ showOptionalFields: !uiState.showOptionalFields });
                    }}
                  >
                    <Text style={styles.optionalFieldsToggleText}>Optional Fields</Text>
                    <Ionicons
                      name={uiState.showOptionalFields ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color="#3B82F6"
                    />
                  </TouchableOpacity>

                  {uiState.showOptionalFields && (
                    <View style={styles.optionalFieldsContent}>
                      <View style={styles.optionalFieldRow}>
                        <View style={styles.optionalFieldGroup}>
                          <Text style={styles.fieldLabel}>SR No</Text>
                          <TextInput
                            style={styles.optionalInput}
                            placeholder="Serial/Reference No"
                            placeholderTextColor="#94A3B8"
                            value={itemState.srNo}
                            onChangeText={(text) => {
                              resetActivityTimer();
                              updateItemState({ srNo: text });
                            }}
                            autoCapitalize="characters"
                          />
                        </View>
                      </View>

                      <View style={styles.optionalFieldRow}>
                        <View style={styles.optionalFieldGroup}>
                          <Text style={styles.fieldLabel}>Manufacturing Date</Text>
                          <TouchableOpacity
                            style={styles.datePickerButton}
                            onPress={() => {
                              resetActivityTimer();
                              setShowManufacturingDatePicker(true);
                            }}
                          >
                            <Ionicons name="calendar" size={18} color="#666" />
                            <Text style={styles.datePickerButtonText}>
                              {itemState.manufacturingDate || 'Select Date'}
                            </Text>
                          </TouchableOpacity>
                          {itemState.manufacturingDate && (
                            <TouchableOpacity
                              style={styles.clearDateButton}
                              onPress={() => {
                                resetActivityTimer();
                                updateItemState({ manufacturingDate: '' });
                              }}
                            >
                              <Ionicons name="close-circle" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Display read-only Category, Type, Group from current item */}
                      {(itemState.currentItem.category || itemState.currentItem.item_type || itemState.currentItem.item_group) && (
                        <View style={styles.readOnlyInfoSection}>
                          <Text style={styles.readOnlyInfoTitle}>Item Information</Text>
                          {itemState.currentItem.category && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Category:</Text>
                              <Text style={styles.readOnlyInfoValue}>
                                {itemState.currentItem.category}
                                {itemState.currentItem.subcategory && ` / ${itemState.currentItem.subcategory}`}
                              </Text>
                            </View>
                          )}
                          {itemState.currentItem.item_type && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Type:</Text>
                              <Text style={styles.readOnlyInfoValue}>{itemState.currentItem.item_type}</Text>
                            </View>
                          )}
                          {itemState.currentItem.item_group && (
                            <View style={styles.readOnlyInfoRow}>
                              <Text style={styles.readOnlyInfoLabel}>Group:</Text>
                              <Text style={styles.readOnlyInfoValue}>{itemState.currentItem.item_group}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Damage Quantity Section */}
                <View style={styles.damageSection}>
                  <View style={styles.damageHeader}>
                    <Text style={styles.subSectionTitle}>Damage Quantity</Text>
                    <View style={styles.damageToggleRow}>
                      <Text style={styles.damageToggleLabel}>Enable</Text>
                      <Switch
                        value={workflowState.damageQtyEnabled}
                        onValueChange={(value) => {
                          resetActivityTimer();
                          updateWorkflowState({ damageQtyEnabled: value });
                          if (!value) {
                            updateItemState({ damageQty: '' });
                          }
                        }}
                        trackColor={{ false: '#555', true: '#EF4444' }}
                        thumbColor={workflowState.damageQtyEnabled ? '#ffebee' : '#f4f3f4'}
                      />
                    </View>
                  </View>
                  {workflowState.damageQtyEnabled && (
                    <View style={styles.damageInputContainer}>
                      <Text style={styles.fieldLabel}>Damaged Quantity</Text>
                      <TextInput
                        style={styles.damageInput}
                        placeholder="Enter damaged quantity"
                        placeholderTextColor="#94A3B8"
                        value={itemState.damageQty}
                        onChangeText={(text) => {
                          resetActivityTimer();
                          updateItemState({ damageQty: text });
                        }}
                        keyboardType="numeric"
                      />
                      <Text style={styles.damageHelperText}>
                        Track items that are damaged or defective
                      </Text>
                    </View>
                  )}
                </View>

                {/* Serial Number Entry - Using SerialNumberEntry Component */}
                <SerialNumberEntry
                  serialInputs={workflowState.serialInputs}
                  requiredSerialCount={workflowState.requiredSerialCount}
                  serialCaptureEnabled={workflowState.serialCaptureEnabled}
                  serialInputTarget={workflowState.serialInputTarget}
                  expectedSerialCount={workflowState.expectedSerialCount}
                  scannerMode={uiState.scannerMode}
                  serialScanTargetId={scannerState.serialScanTargetId}
                  showScanner={uiState.showScanner}
                  continuousScanMode={uiState.continuousScanMode}
                  serialRequirementMessage={serialRequirementMessage}
                  missingSerialCount={missingSerialCount}
                  extraSerialCount={extraSerialCount}
                  onToggleSerialCapture={handleToggleSerialCapture}
                  onSerialValueChange={updateSerialValue}
                  onScanSerialSlot={handleScanSerialSlot}
                  onRemoveSerial={handleRemoveSerial}
                  onScanNextSerial={handleScanNextSerial}
                  onAddSerial={() => {
                    const newInput = createSerialInput(workflowState.serialInputs.length);
                    addSerialInput(newInput);
                  }}
                  onActivityReset={resetActivityTimer}
                />

                <View style={styles.conditionSection}>
                  <Text style={styles.subSectionTitle}>Item Condition</Text>
                  <Text style={styles.conditionHelper}>Helps supervisors prioritise follow-up actions.</Text>
                  <View style={styles.conditionChips}>
                    {ITEM_CONDITION_OPTIONS.map((option) => {
                      const isActive = itemState.itemCondition === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[styles.conditionChip, isActive && styles.conditionChipActive]}
                          onPress={() => {
                            updateItemState({
                              itemCondition: option.value,
                              conditionManuallySet: true
                            });
                          }}
                        >
                          <Text style={[styles.conditionChipText, isActive && styles.conditionChipTextActive]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Photo Capture - Using PhotoCapture Component */}
                <PhotoCapture
                  photos={photoState.photoProofs}
                  selectedPhotoType={photoState.selectedPhotoType}
                  showPhotoCapture={photoState.showPhotoCapture}
                  photoCaptureLoading={photoState.photoCaptureLoading}
                  photoCameraType={photoState.photoCameraType}
                  isWeb={isWeb}
                  serialPhotosRequired={serialPhotosRequired}
                  serialPhotoShortfall={serialPhotoShortfall}
                  photoCameraRef={photoCameraRef}
                  onPhotoTypeChange={(type) => updatePhotoState({ selectedPhotoType: type })}
                  onOpenPhotoCapture={handleOpenPhotoCapture}
                  onClosePhotoCapture={handleClosePhotoCapture}
                  onCapturePhoto={handleCapturePhoto}
                  onFlipCamera={handleFlipPhotoCamera}
                  onRemovePhoto={handleRemovePhoto}
                />

                {itemState.countedQty && (
                  <View style={styles.varianceBox}>
                    <Text style={styles.varianceLabel}>Variance:</Text>
                    <Text style={[styles.varianceValue, (parseFloat(itemState.countedQty) - (itemState.currentItem?.stock_qty || 0)) !== 0 && styles.varianceNonZero]}>
                      {(parseFloat(itemState.countedQty) - (itemState.currentItem?.stock_qty || 0)).toFixed(2)}
                    </Text>
                  </View>
                )}

                <TextInput
                  style={styles.remarkInput}
                  placeholder="Optional remark"
                  placeholderTextColor="#94A3B8"
                  value={itemState.remark}
                  onChangeText={(text) => updateItemState({ remark: text })}
                  multiline
                />

                <View style={styles.actionButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, uiState.saving && styles.buttonDisabled]}
                    onPress={handleSaveCount}
                    disabled={uiState.saving}
                  >
                    <Text style={styles.saveButtonText}>{uiState.saving ? 'Saving...' : 'Save Count'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Barcode Scanner - Using BarcodeScanner Component */}
          <BarcodeScanner
            visible={uiState.showScanner}
            scannerMode={uiState.scannerMode}
            continuousScanMode={uiState.continuousScanMode}
            isLoadingItem={isLoadingItem}
            scanFeedback={uiState.scanFeedback || scannerState.scanFeedback}
            serialLabel={activeSerialLabel}
            expectedSerialCount={workflowState.expectedSerialCount}
            completedSerialCount={completedSerialCount}
            isWeb={isWeb}
            onBarcodeScanned={handleBarCodeScanned}
            onClose={() => {
              updateUiState({ showScanner: false, scannerMode: 'item' });
              updateScannerState({ serialScanTargetId: null });
            }}
            onToggleContinuousMode={() => updateUiState({ continuousScanMode: !uiState.continuousScanMode })}
          />

          <Modal visible={photoState.showPhotoCapture} animationType="slide">
            <View style={styles.photoModalContainer}>
              <CameraView
                ref={photoCameraRef}
                style={styles.photoCamera}
                facing={photoState.photoCameraType}
              />
              <ResultOverlay
                onClose={handleClosePhotoCapture}
                onFlip={handleFlipPhotoCamera}
                onCapture={handleCapturePhoto}
                loading={photoState.photoCaptureLoading}
              />
            </View>
          </Modal>

          {/* Variance Reason Modal */}
          <Modal visible={uiState.showReasonModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Variance Reason Required</Text>
                <Text style={styles.modalSubtitle}>Please select a reason for the variance</Text>

                {itemState.varianceReasons?.map((reason: VarianceReason) => (
                  <TouchableOpacity
                    key={reason.code}
                    style={[styles.reasonOption, itemState.selectedReason === reason.code && styles.reasonSelected]}
                    onPress={() => updateItemState({ selectedReason: reason.code })}
                  >
                    <Text style={styles.reasonText}>{reason.label}</Text>
                  </TouchableOpacity>
                ))}

                {itemState.selectedReason === 'other' && (
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Enter reason"
                    placeholderTextColor="#94A3B8"
                    value={itemState.varianceNote}
                    onChangeText={(text) => updateItemState({ varianceNote: text })}
                    multiline
                  />
                )}

                <TouchableOpacity
                  style={[styles.confirmButton, !itemState.selectedReason && styles.buttonDisabled]}
                  onPress={() => {
                    if (itemState.selectedReason) {
                      updateUiState({ showReasonModal: false });
                      handleSaveCount();
                    }
                  }}
                  disabled={!itemState.selectedReason}
                >
                  <Text style={styles.confirmButtonText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Unknown Item Report Modal */}
          <Modal visible={uiState.showUnknownItemModal} transparent animationType="fade">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalOverlay}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => updateUiState({ showUnknownItemModal: false })}
              >
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Ionicons name="alert-circle-outline" size={48} color="#FF9800" />
                      <Text style={styles.modalTitle}>Report Unknown Item</Text>
                    </View>

                    <View style={styles.unknownItemInfo}>
                      <Text style={styles.modalLabel}>Barcode:</Text>
                      <Text style={styles.unknownBarcode}>{uiState.unknownItemData.barcode}</Text>
                    </View>

                    <Text style={styles.modalLabel}>Description / Notes:</Text>
                    <TextInput
                      style={[styles.noteInput, styles.unknownItemInput]}
                      placeholder="Enter item description, brand, size, etc."
                      placeholderTextColor="#666"
                      value={uiState.unknownItemData.description}
                      onChangeText={(text) => updateUiState({ unknownItemData: { ...uiState.unknownItemData, description: text } })}
                      multiline
                      numberOfLines={4}
                      autoFocus
                    />

                    <Text style={styles.helpText}>
                      This item will be reported to the supervisor for review and manual entry into the system.
                    </Text>

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          updateUiState({
                            showUnknownItemModal: false,
                            unknownItemData: { barcode: '', description: '' }
                          });
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalSubmitButton]}
                        onPress={submitUnknownItem}
                      >
                        <Text style={styles.modalSubmitButtonText}>Report Item</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* Add Quantity Modal */}
          <Modal visible={workflowState.showAddQuantityModal} transparent animationType="slide">
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalOverlay}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => updateWorkflowState({ showAddQuantityModal: false })}
              >
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Ionicons name="add-circle-outline" size={48} color="#3B82F6" />
                      <Text style={styles.modalTitle}>Add Quantity</Text>
                    </View>

                    {itemState.currentItem && workflowState.existingCountLine && (
                      <View style={styles.addQtyInfo}>
                        <Text style={styles.addQtyItemName}>{itemState.currentItem.name}</Text>
                        <Text style={styles.addQtyItemCode}>{itemState.currentItem.item_code}</Text>

                        <View style={styles.addQtyCurrentContainer}>
                          <Text style={styles.addQtyLabel}>Current Count:</Text>
                          <Text style={styles.addQtyValue}>
                            {workflowState.existingCountLine.counted_qty || 0} {itemState.currentItem.uom_name || ''}
                          </Text>
                        </View>

                        <View style={styles.addQtyInputContainer}>
                          <Text style={styles.addQtyLabel}>Add Quantity:</Text>
                          <TextInput
                            style={styles.addQtyInput}
                            placeholder="Enter quantity to add"
                            placeholderTextColor="#94A3B8"
                            value={workflowState.additionalQty}
                            onChangeText={(text) => updateWorkflowState({ additionalQty: text })}
                            keyboardType="numeric"
                            autoFocus
                          />
                        </View>

                        {workflowState.additionalQty && !isNaN(parseFloat(workflowState.additionalQty)) && (
                          <View style={styles.addQtyNewTotal}>
                            <Text style={styles.addQtyLabel}>New Total:</Text>
                            <Text style={styles.addQtyTotalValue}>
                              {((workflowState.existingCountLine.counted_qty || 0) + parseFloat(workflowState.additionalQty)).toFixed(2)} {itemState.currentItem.uom_name || ''}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          updateWorkflowState({ showAddQuantityModal: false, additionalQty: '' });
                          resetForm();
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.modalButton,
                          styles.modalSubmitButton,
                          (!workflowState.additionalQty || isNaN(parseFloat(workflowState.additionalQty)) || parseFloat(workflowState.additionalQty) <= 0) && styles.buttonDisabled
                        ]}
                        onPress={handleAddQuantity}
                        disabled={!workflowState.additionalQty || isNaN(parseFloat(workflowState.additionalQty)) || parseFloat(workflowState.additionalQty) <= 0 || uiState.saving}
                      >
                        {uiState.saving ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.modalSubmitButtonText}>Add Quantity</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* Manufacturing Date Picker Modal */}
          {showManufacturingDatePicker && (
            <Modal visible={showManufacturingDatePicker} transparent animationType="fade">
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => setShowManufacturingDatePicker(false)}
              >
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.datePickerModal}>
                    <Text style={styles.datePickerTitle}>Manufacturing Date</Text>
                    <View style={styles.datePickerContainer}>
                      <TextInput
                        style={styles.dateInput}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#94A3B8"
                        value={itemState.manufacturingDate}
                        onChangeText={(text) => {
                          resetActivityTimer();
                          updateItemState({ manufacturingDate: text });
                        }}
                        autoCapitalize="none"
                      />
                    </View>
                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        onPress={() => setShowManufacturingDatePicker(false)}
                      >
                        <Text style={styles.modalCancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalSubmitButton]}
                        onPress={() => {
                          resetActivityTimer();
                          setShowManufacturingDatePicker(false);
                        }}
                      >
                        <Text style={styles.modalSubmitButtonText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          )}
        </LinearGradient>
      )}
    </KeyboardAvoidingView>
  );
}
