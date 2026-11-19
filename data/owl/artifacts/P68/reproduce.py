import os
import json
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.utils import resample
from sklearn.metrics import accuracy_score
from catboost import CatBoostClassifier

def load_veremi_data(data_dir):
    # Find the directory containing the results
    # Based on TASK.md, the path is veins_maat.uc1.14505201.180205_165350/veins-maat/simulations/securecomm2018/results/
    results_dir = os.path.join(data_dir, "veins_maat.uc1.14505201.180205_165350", "veins-maat", "simulations", "securecomm2018", "results")
    
    gt_path = os.path.join(results_dir, "GroundTruthJSONlog.json")
    
    # Load Ground Truth
    labels = []
    timestamps = []
    with open(gt_path, 'r') as f:
        for line in f:
            data = json.loads(line)
            # attackerType 0 is benign, others are anomalous. 
            # But the paper says "binary classification... benign (0) and anomalous (1)"
            # In VeReMi, attackerType 0 is usually the normal/benign.
            labels.append(1 if data['attackerType'] > 0 else 0)
            timestamps.append(data['time'])

    # Load Feature Logs
    # We need to find the JSONlog files. 
    # The task shows JSONlog-2-19-A0.json and JSONlog-7-49-A1.json
    # We will look for all JSONlog files in that directory.
    feature_files = [f for f in os.listdir(results_dir) if f.startswith("JSONlog") and f.endswith(".json")]
    
    all_features = []
    all_labels = []
    all_times = []

    for f_name in feature_files:
        f_path = os.path.join(results_dir, f_name)
        with open(f_path, 'r') as f:
            for line in f:
                data = json.loads(line)
                # We need to match the timestamp to the ground truth
                # The feature log has 'rcvTime'
                all_features.append({
                    'pos_x': data['pos'][0],
                    'pos_y': data['pos'][1],
                    'pos_z': data['pos'][2],
                    'spd_x': data['spd'][0],
                    'spd_y': data['spd'][1],
                    'spd_z': data['spd'][2],
                    'time': data['rcvTime']
                })

    df_feat = pd.DataFrame(all_features)
    df_gt = pd.DataFrame({'time': timestamps, 'label': labels})

    # Merge on time (using merge_asof for closest timestamp)
    df_feat = df_feat.sort_values('time')
    df_gt = df_gt.sort_values('time')
    
    merged = pd.merge_asof(df_feat, df_gt, on='time', direction='nearest')
    
    # Drop rows where no label was found
    merged = merged.dropna(subset=['label'])
    
    return merged[['pos_x', 'pos_y', 'pos_z', 'spd_x', 'spd_y', 'spd_z', 'label']]

def main():
    data_dir = "data"
    df = load_veremi_data(data_dir)

    # 1. Data Balancing (Random Under-sampling)
    df_majority = df[df.label == 0]
    df_minority = df[df.label == 1]
    
    df_majority_downsampled = resample(df_majority, 
                                       replace=False,    # sample without replacement
                                       n_samples=len(df_minority), # match minority class
                                       random_state=42) 

    df_balanced = pd.concat([df_majority_downsampled, df_minority])
    
    # 2. Feature Selection (Leveled Top-4)
    # According to Table 15 and the paper's logic for VeReMi Binary:
    # Leveled top features: pos_x, pos_y, spd_x, spd_y
    top_features = ['pos_x', 'pos_y', 'spd_x', 'spd_y']
    X = df_balanced[top_features]
    y = df_balanced['label']

    # 3. Preprocessing
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 4. Train/Test Split (70/30)
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.30, random_state=42
    )

    # 5. Train Independent Classifier (CatBoost)
    # Hyperparameters for CatBoost are not explicitly detailed for the final test, 
    # but we use defaults or standard settings.
    model = CatBoostClassifier(
        iterations=100,
        learning_rate=0.1,
        depth=6,
        loss_function='Logloss',
        verbose=False,
        random_seed=42
    )
    model.fit(X_train, y_train)

    # 6. Evaluation
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred) * 100

    # 7. Write Result
    result = {
        "metric": "accuracy",
        "value": round(acc, 2),
        "unit": "%",
        "split": "70/30 train/test split",
        "notes": "Used top-4 features (pos_x, pos_y, spd_x, spd_y) as identified by the Leveled feature ensemble method in the paper."
    }

    with open("RESULT.json", "w") as f:
        json.dump(result, f, indent=2)

if __name__ == "__main__":
    main()
