import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
import json
from tqdm import tqdm

def load_data(file_path):
    # Columns: WAP001 ... WAP520 (520), LONGITUDE, LATITUDE, FLOOR, BUILDINGID, SPACEID, RELATIVEPOSITION, USERID, PHONEID, TIMESTAMP
    df = pd.read_csv(file_path, low_memory=False)
    # Ensure RSSI columns are numeric
    rssi_cols = df.columns[:520]
    for col in rssi_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(100)
    return df

def convert_to_binary_features(df, bin_width=5):
    # Thresholds uniformly distributed in range <-110, -10> with a step (bin width)
    # Range: -110, -105, ..., -15, -10
    thresholds = np.arange(-110, -10 + bin_width, bin_width)
    num_bins = len(thresholds)
    num_waps = 520
    
    rssi_data = df.iloc[:, :num_waps].values
    num_samples = rssi_data.shape[0]
    
    # binary_features: (num_samples, num_waps * num_bins)
    binary_features = np.zeros((num_samples, num_waps * num_bins), dtype=np.int8)
    
    for i in range(num_waps):
        rssi = rssi_data[:, i]
        for b_idx, thresh in enumerate(thresholds):
            # "whenever the signal strength (expressed in dBm) of the i-th network exceeds this threshold, its value is set to 1"
            # RSSI = 100 means not present.
            binary_features[:, i * num_bins + b_idx] = ((rssi != 100) & (rssi > thresh)).astype(np.int8)
            
    return binary_features

def main():
    # Parameters from Table 1 (best row)
    BIN_WIDTH = 5
    PzGe = 0.3135
    PzGne = 0.0004
    
    print("Loading data...")
    train_df = load_data('data/trainingData.csv')
    val_df = load_data('data/validationData.csv')
    
    print("Converting features...")
    train_features = convert_to_binary_features(train_df, BIN_WIDTH)
    val_features = convert_to_binary_features(val_df, BIN_WIDTH)
    
    # Database construction
    # "We used DBScan algorithm with parameters epsilon = 1 and MinPts = 1 to divide the input dataset into clusters of scans taken at one location."
    # Coordinates are LONGITUDE, LATITUDE.
    coords = train_df[['LONGITUDE', 'LATITUDE']].values
    
    print("Clustering locations...")
    db = DBSCAN(eps=1, min_samples=1).fit(coords)
    labels = db.labels_
    unique_labels = np.unique(labels)
    
    # "A random scan drawn from each cluster was used to characterize the environment, 
    # whereas 10 other scans (also drawn at random) were used to construct the database of known places."
    np.random.seed(42)
    
    database_indices = []
    env_indices = []
    
    for label in unique_labels:
        cluster_indices = np.where(labels == label)[0]
        np.random.shuffle(cluster_indices)
        
        # One for environment
        env_indices.append(cluster_indices[0])
        
        # Up to 10 for database
        db_count = min(len(cluster_indices) - 1, 10)
        database_indices.extend(cluster_indices[1:1+db_count])
        
    database_indices = np.array(database_indices)
    env_indices = np.array(env_indices)
    
    # Database features and labels
    db_features = train_features[database_indices]
    db_labels = train_df.loc[database_indices, ['FLOOR', 'BUILDINGID']].values # FLOOR, BUILDINGID
    
    # Precompute logs for Naive Bayes (simplified FAB-MAP)
    eps = 1e-10
    log_1_1 = np.log(1 - PzGne + eps)
    log_0_1 = np.log(PzGne + eps)
    log_1_0 = np.log(PzGe + eps)
    log_0_0 = np.log(1 - PzGe + eps)
    
    print("Evaluating on validation set...")
    correct = 0
    num_val = len(val_features)
    
    # Process in batches to avoid memory issues
    batch_size = 100
    for start_idx in range(0, num_val, batch_size):
        end_idx = min(start_idx + batch_size, num_val)
        batch_z = val_features[start_idx:end_idx]
        batch_true_labels = val_df.loc[val_df.index[start_idx:end_idx], ['FLOOR', 'BUILDINGID']].values # FLOOR, BUILDINGID
        
        for i in range(len(batch_z)):
            z = batch_z[i]
            
            # n11 = sum_{i: z_i=1, e_ij=1} 1
            n11 = z @ db_features.T
            n10 = np.sum(z) - n11
            n01 = (1 - z) @ db_features.T
            n00 = np.sum(1 - z) - n01
            
            log_probs = n11 * log_1_1 + n10 * log_1_0 + n01 * log_0_1 + n00 * log_0_0
            
            best_match_idx = np.argmax(log_probs)
            pred_floor, pred_building = db_labels[best_match_idx]
            true_floor, true_building = batch_true_labels[i]
            
            if pred_floor == true_floor and pred_building == true_building:
                correct += 1
                
    accuracy = correct / num_val * 100
    print(f"Building and Floor Accuracy: {accuracy:.2f}%")
    
    result = {
        "metric": "building and floor accuracy (score)",
        "value": accuracy,
        "unit": "%",
        "split": "validation",
        "notes": "Implemented simplified FAB-MAP using Naive Bayes assumption (no Chow-Liu tree for feature dependencies). Used provided PzGe and PzGne."
    }
    
    with open('RESULT.json', 'w') as f:
        json.dump(result, f)

if __name__ == "__main__":
    main()
