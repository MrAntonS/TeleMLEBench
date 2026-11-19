import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import json
from sklearn.metrics import accuracy_score

def set_seed(seed=1000):
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

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



def train_model(X, y, output_dim, epochs=50, batch_size=20, lr=1e-4):
    X_tensor = torch.FloatTensor(X.copy())
    y_tensor = torch.LongTensor(y.copy())
    dataset = TensorDataset(X_tensor, y_tensor)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    model = SimpleNN(X.shape[1], output_dim)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    
    model.train()
    for epoch in range(epochs):
        for batch_X, batch_y in loader:
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
    return model



def predict_model(model, X):
    model.eval()
    with torch.no_grad():
        X_tensor = torch.FloatTensor(X)
        outputs = model(X_tensor)
        return torch.argmax(outputs, dim=1).numpy()

def main():
    set_seed()
    
    # Load data
    train_df = pd.read_csv('data/trainingData.csv', header=0)
    valid_df = pd.read_csv('data/validationData.csv', header=0)
    
    # Preprocess
    train_df = train_df.replace(100, -105)
    valid_df = valid_df.replace(100, -105)
    
    # Filter APs with no variation (combined)
    # Use only the WAP columns for variation check
    wap_cols = [col for col in train_df.columns if col.startswith('WAP')]
    combined_rssi = pd.concat([train_df[wap_cols], valid_df[wap_cols]])
    variations = combined_rssi.std() == 0
    cols_to_keep = variations[~variations].index.tolist()
    
    X_train_all = train_df[cols_to_keep].values
    y_train_all_b = train_df['BUILDINGID'].values # BuildingID
    y_train_all_f = train_df['FLOOR'].values # Floor
    
    X_valid_all = valid_df[cols_to_keep].values
    y_valid_all_b = valid_df['BUILDINGID'].values # BuildingID
    y_valid_all_f = valid_df['FLOOR'].values # Floor
    
    # Step 1: Building ID Classification
    # Building IDs are 0, 1, 2.
    model_b = train_model(X_train_all, y_train_all_b, output_dim=3)
    pred_b_valid = predict_model(model_b, X_valid_all)
    
    # Step 2: Floor Level Classification (Upper vs Lower)
    # Upper: floor >= 2, Lower: floor < 2
    # We do this for each building.
    
    final_floor_preds = np.zeros(len(valid_df), dtype=int)
    
    for b in [0, 1, 2]:
        # Training data for building b
        train_b_mask = (y_train_all_b == b)
        if not np.any(train_b_mask): continue
        
        X_train_b = X_train_all[train_b_mask]
        y_train_b_level = (y_train_all_f[train_b_mask] >= 2).astype(int)
        
        # Train binary classifier for level
        model_level_b = train_model(X_train_b, y_train_b_level, output_dim=2)
        
        # Validation data predicted to be in building b
        valid_b_mask = (pred_b_valid == b)
        if not np.any(valid_b_mask): continue
        
        X_valid_b = X_valid_all[valid_b_mask]
        pred_level_b = predict_model(model_level_b, X_valid_b)
        
        # Now we have the level (0 or 1). Now we need the actual floor.
        # We train a model for each level within each building.
        for level in [0, 1]:
            # Training data for building b and level
            mask = (y_train_all_b == b)
            if level == 1:
                mask = mask & (y_train_all_f >= 2)
            else:
                mask = mask & (y_train_all_f < 2)
            
            if not np.any(mask): continue
            
            X_train_bl = X_train_all[mask]
            y_train_bl = y_train_all_f[mask]
            
            # Map floors to 0..N-1
            unique_floors = np.unique(y_train_bl)
            floor_map = {f: i for i, f in enumerate(unique_floors)}
            inv_floor_map = {i: f for f, i in floor_map.items()}
            y_train_bl_mapped = np.array([floor_map[f] for f in y_train_bl])
            
            model_floor_bl = train_model(X_train_bl, y_train_bl_mapped, output_dim=len(unique_floors))
            
            # Predict for validation data in building b and predicted level
            # We need to find which validation samples are in building b AND predicted level
            # pred_level_b is for the subset X_valid_b
            
            # Indices of X_valid_b that were predicted to be in this level
            level_mask_in_b = (pred_level_b == level)
            
            # Map these back to the original valid_df indices
            valid_b_indices = np.where(valid_b_mask)[0]
            target_indices = valid_b_indices[level_mask_in_b]
            
            if len(target_indices) == 0: continue
            
            X_target = X_valid_all[target_indices]
            pred_floor_mapped = predict_model(model_floor_bl, X_target)
            
            # Map back to actual floor values
            pred_floors = np.array([inv_floor_map[p] for p in pred_floor_mapped])
            final_floor_preds[target_indices] = pred_floors

    # Calculate floor hit rate
    hit_rate = accuracy_score(y_valid_all_f, final_floor_preds) * 100
    
    result = {
        "metric": "floor hit rate",
        "value": hit_rate,
        "unit": "%",
        "split": "validation",
        "notes": "Implemented SCNN with simple NN for each stage. Used combined training/validation for AP variation filtering."
    }
    
    with open('RESULT.json', 'w') as f:
        json.dump(result, f)
    
    print(f"Floor hit rate: {hit_rate:.2f}%")

if __name__ == "__main__":
    main()
