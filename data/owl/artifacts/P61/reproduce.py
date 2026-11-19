import pandas as pd
import numpy as np
import json

def get_binary_features(df, bin_width=5):
    # WAP columns are the first 520 columns
    wap_cols = df.columns[:520]
    
    # Thresholds from -110 to -10 with step bin_width
    thresholds = np.arange(-110, -10 + 1, bin_width)
    
    # Convert RSSI to binary features
    # RSSI = 100 means not found.
    # We only consider RSSI < 100.
    
    # To optimize, we can process in chunks or use numpy broadcasting
    # The data is (N, 520)
    data = df[wap_cols].values
    
    # Create a mask for valid RSSI
    valid_mask = data < 100
    
    # We want to create a binary matrix of shape (N, 520 * len(thresholds))
    # For each WAP and each threshold, 1 if RSSI >= threshold and RSSI < 100, else 0.
    
    # Use broadcasting: (N, 520, 1) >= (1, 1, len(thresholds))
    # This might be too memory intensive: (19937, 520, 21) * 1 byte approx 218 MB.
    # That's fine.
    
    # Expand thresholds to (1, 1, len(thresholds))
    T = thresholds.reshape(1, 1, -1)
    
    # Expand data to (N, 520, 1)
    D = data[:, :, np.newaxis]
    
    # Binary features: (N, 520, 21)
    # Feature is 1 if RSSI is valid AND RSSI >= threshold
    features = (D < 100) & (D >= T)
    
    # Flatten the last two dimensions: (N, 520 * 21)
    return features.reshape(len(df), -1).astype(np.int8)

def main():
    # Parameters
    BIN_WIDTH = 5
    PzGe = 0.3135
    PzGne = 0.0004
    
    # Load data
    train_df = pd.read_csv('data/trainingData.csv')
    val_df = pd.read_csv('data/validationData.csv')
    
    # Extract features
    print("Extracting training features...")
    train_features = get_binary_features(train_df, BIN_WIDTH)
    
    print("Extracting validation features...")
    val_features = get_binary_features(val_df, BIN_WIDTH)
    
    # Database of known places: training set
    # We need BuildingID and Floor for evaluation
    train_building = train_df['BUILDINGID'].values
    train_floor = train_df['FLOOR'].values
    
    # Matching
    # For each test scan Z_test, find L that maximizes P(Z_test | L)
    # log P(Z_test | L) = sum_{i} log P(z_{i, test} | L)
    # P(z_i | L) = PzGe if z_i_test=1 and z_i_db=1
    #            = 1 - PzGe if z_i_test=0 and z_i_db=1
    #            = PzGne if z_i_test=1 and z_i_db=0
    #            = 1 - PzGne if z_i_test=0 and z_i_db=0
    
    # Precompute logs
    log_PzGe = np.log(PzGe)
    log_1_PzGe = np.log(1 - PzGe)
    log_PzGne = np.log(PzGne)
    log_1_PzGne = np.log(1 - PzGne)
    
    correct = 0
    total = len(val_df)
    
    print(f"Matching {total} validation examples...")
    
    # To avoid memory issues and speed up, we can process validation scans in batches
    batch_size = 100
    for i in range(0, total, batch_size):
        end = min(i + batch_size, total)
        val_batch = val_features[i:end] # (batch, num_features)
        
        # For each scan in batch, compute scores for all training locations
        # Score(test, db) = sum_{j} log P(z_{j, test} | L_db)
        # This is a large matrix multiplication if we are careful.
        # Let's rewrite the score:
        # Score = sum_{j: z_j_test=1, z_j_db=1} log_PzGe 
        #       + sum_{j: z_j_test=0, z_j_db=1} log_1_PzGe
        #       + sum_{j: z_j_test=1, z_j_db=0} log_PzGne
        #       + sum_{j: z_j_test=0, z_j_db=0} log_1_PzGne
        
        # Let n_11 = count(z_test=1, z_db=1)
        # Let n_01 = count(z_test=0, z_db=1)
        # Let n_10 = count(z_test=1, z_db=0)
        # Let n_00 = count(z_test=0, z_db=0)
        
        # n_11 = val_batch @ train_features.T
        # n_10 = sum(val_batch) - n_11
        # n_01 = sum(train_features, axis=0) - n_11
        # n_00 = total_features - n_11 - n_10 - n_01
        
        val_batch_64 = val_batch.astype(np.int64)
        train_features_64 = train_features.astype(np.int64)
        n_11 = val_batch_64 @ train_features_64.T # (batch, num_train)

        sum_val = val_batch_64.sum(axis=1, keepdims=True) # (batch, 1)
        sum_train = train_features_64.sum(axis=1) # (num_train,)

        n_10 = sum_val - n_11
        n_01 = sum_train - n_11

        num_features = np.int64(train_features.shape[1])
        n_00 = num_features - n_11 - n_10 - n_01
        
        scores = (n_11 * log_PzGe + 
                  n_01 * log_1_PzGe + 
                  n_10 * log_PzGne + 
                  n_00 * log_1_PzGne)
        
        best_matches = np.argmax(scores, axis=1)
        
        # Evaluate
        val_building = val_df['BUILDINGID'].values[i:end]
        val_floor = val_df['FLOOR'].values[i:end]
        
        match_building = train_building[best_matches]
        match_floor = train_floor[best_matches]
        
        correct += np.sum((val_building == match_building) & (val_floor == match_floor))
        
    accuracy = (correct / total) * 100
    print(f"Accuracy: {accuracy:.2f}%")
    
    result = {
        "metric": "building and floor accuracy (score)",
        "value": accuracy,
        "unit": "%",
        "split": "validation",
        "notes": "Implemented generative matching based on FAB-MAP's probabilistic model. Used all training data as database."
    }
    
    with open('RESULT.json', 'w') as f:
        json.dump(result, f, indent=2)

if __name__ == "__main__":
    main()
