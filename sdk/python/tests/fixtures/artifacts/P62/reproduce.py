import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import json

def set_seed(seed=1000):
    torch.manual_seed(seed)
    np.random.seed(seed)

def preprocess_data(df):
    # The first 520 columns are WAPs
    wap_cols = df.columns[:520]
    # Ensure numeric and replace non-detection RSSI (+100) with -105 dBm
    df[wap_cols] = df[wap_cols].apply(pd.to_numeric, errors='coerce').fillna(-105)
    df[wap_cols] = df[wap_cols].replace(100, -105)
    return df, wap_cols

def filter_aps(train_df, wap_cols):
    # Exclude APs with no variation in training set
    variances = train_df[wap_cols].var()
    valid_aps = variances[variances > 0].index.tolist()
    return valid_aps

class SimpleNN(nn.Module):
    def __init__(self, input_dim, output_dim):
        super(SimpleNN, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, output_dim)
        )
    def forward(self, x):
        return self.net(x)

def train_model(X, y, output_dim, epochs=50, lr=1e-4, batch_size=20):
    X_tensor = torch.FloatTensor(X)
    y_tensor = torch.LongTensor(y)
    dataset = TensorDataset(X_tensor, y_tensor)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    model = SimpleNN(X.shape[1], output_dim)
    optimizer = optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss()
    
    model.train()
    for epoch in range(epochs):
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            outputs = model(batch_x)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
    return model

def main():
    set_seed(1000)
    
    # Load data - using header=0 because the files contain column names like WAP001
    train_df = pd.read_csv('data/trainingData.csv', header=0)
    val_df = pd.read_csv('data/validationData.csv', header=0)
    
    # Column indices based on TASK.md
    # 0-519: WAPs, 520: LONGITUDE, 521: LATITUDE, 522: FLOOR, 523: BUILDINGID
    WAP_START, WAP_END = 0, 520
    COL_FLOOR = 522
    COL_BUILDING = 523
    
    # Preprocessing
    train_df, wap_cols = preprocess_data(train_df)
    val_df, _ = preprocess_data(val_df)
    
    # Filter APs (no variation)
    valid_wap_cols = filter_aps(train_df, wap_cols)
    
    X_train = train_df[valid_wap_cols].values
    y_train_bldg = train_df.iloc[:, COL_BUILDING].values.astype(int)
    y_train_floor = train_df.iloc[:, COL_FLOOR].values.astype(int)
    
    X_val = val_df[valid_wap_cols].values
    y_val_bldg = val_df.iloc[:, COL_BUILDING].values.astype(int)
    y_val_floor = val_df.iloc[:, COL_FLOOR].values.astype(int)
    
    # SCNN Pipeline
    # Stage 1: Building ID
    # Building IDs are 0, 1, 2
    bldg_model = train_model(X_train, y_train_bldg, 3)
    bldg_model.eval()
    with torch.no_grad():
        val_bldg_preds = torch.argmax(bldg_model(torch.FloatTensor(X_val)), dim=1).numpy()
    
    # Stage 2 & 3: Floor prediction
    final_floor_preds = np.zeros(len(y_val_floor), dtype=int)
    
    for bldg in [0, 1, 2]:
        # Training data for this building
        idx_train = (y_train_bldg == bldg)
        X_bldg = X_train[idx_train]
        y_bldg_floor = y_train_floor[idx_train]
        
        if len(X_bldg) == 0: continue
        
        # Map floors to 0..N-1 for CrossEntropyLoss
        unique_floors = np.unique(y_bldg_floor)
        floor_map = {f: i for i, f in enumerate(unique_floors)}
        inv_floor_map = {i: f for f, i in floor_map.items()}
        
        y_bldg_mapped = np.array([floor_map[f] for f in y_bldg_floor])
        
        floor_model = train_model(X_bldg, y_bldg_mapped, len(unique_floors))
        floor_model.eval()
        
        # Validation data for this building (based on predicted building)
        idx_val = (val_bldg_preds == bldg)
        if np.any(idx_val):
            with torch.no_grad():
                preds_mapped = torch.argmax(floor_model(torch.FloatTensor(X_val[idx_val])), dim=1).numpy()
                final_floor_preds[idx_val] = [inv_floor_map[p] for p in preds_mapped]

    # Calculate Floor Hit Rate
    correct_floors = np.sum(final_floor_preds == y_val_floor)
    hit_rate = (correct_floors / len(y_val_floor)) * 100
    
    result = {
        "metric": "floor hit rate",
        "value": hit_rate,
        "unit": "%",
        "split": "validation",
        "notes": "Implemented sequential building-then-floor classification. Used MLP as approximation for CNN since AP coordinates for 'RSSI pictures' were not provided. Filtered constant APs. Fixed header loading issue."
    }
    
    with open('RESULT.json', 'w') as f:
        json.dump(result, f)

if __name__ == "__main__":
    main()
